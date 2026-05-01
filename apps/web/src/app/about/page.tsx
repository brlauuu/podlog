import { readFile } from "fs/promises";
import { join } from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import AboutToc, { type AboutTocItem } from "@/components/AboutToc";
import { makeUniqueSlugger } from "@/lib/docs-slug";

export const dynamic = "force-dynamic";

async function readDocOrNull(filename: string): Promise<string | null> {
  const path = join(process.cwd(), "..", "..", "docs", filename);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const external = typeof href === "string" && /^https?:\/\//i.test(href);
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
};

interface HeadingId {
  level: 1 | 2;
  text: string;
  id: string;
}

/**
 * Walk a markdown document and emit `{level, text, id}` for every H1 and H2
 * encountered, preserving order. The slugger is shared across documents so
 * collisions across the About + Changelog pages produce stable, unique ids.
 *
 * Built once on the server so the rendered headings, the right-rail TOC,
 * and the changelog version list all reference the exact same id strings.
 */
function extractHeadings(
  markdown: string,
  slugger: (text: string) => string,
): HeadingId[] {
  const out: HeadingId[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^(#{1,2})\s+(.+)$/);
    if (!m) continue;
    const level = m[1].length === 1 ? 1 : 2;
    const text = m[2].trim();
    out.push({ level, text, id: slugger(text) });
  }
  return out;
}

/** Build a Map keyed by the heading's first occurrence — used to look up
 * ids from React component callbacks without re-slugging (which would
 * collide and append `-1` suffixes). The first occurrence wins; if a
 * heading text repeats inside one doc, the second instance gets no id —
 * that's fine for our use here since the changelog version texts are unique
 * by construction. */
function firstOccurrenceMap(headings: HeadingId[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of headings) {
    if (!m.has(h.text)) m.set(h.text, h.id);
  }
  return m;
}

export default async function AboutPage() {
  const [aboutContent, changelogContent] = await Promise.all([
    readDocOrNull("about.md"),
    readDocOrNull("CHANGELOG.md"),
  ]);

  const slugger = makeUniqueSlugger();
  const aboutHeadings = aboutContent ? extractHeadings(aboutContent, slugger) : [];
  const changelogHeadings = changelogContent
    ? extractHeadings(changelogContent, slugger)
    : [];

  const aboutH1 = aboutHeadings.find((h) => h.level === 1);
  const changelogH1 = changelogHeadings.find((h) => h.level === 1);

  const versions: AboutTocItem[] = changelogHeadings
    .filter((h) => h.level === 2 && h.text.startsWith("["))
    .map((h) => ({ id: h.id, text: h.text }));

  const aboutIdByText = firstOccurrenceMap(aboutHeadings);
  const changelogIdByText = firstOccurrenceMap(changelogHeadings);

  const aboutMarkdownComponents = {
    ...markdownComponents,
    h1: ({ children }: { children?: React.ReactNode }) => {
      const text = textFromNode(children).trim();
      const id = aboutIdByText.get(text);
      return <h1 id={id}>{children}</h1>;
    },
  };

  const changelogMarkdownComponents = {
    ...markdownComponents,
    h1: ({ children }: { children?: React.ReactNode }) => {
      const text = textFromNode(children).trim();
      const id = changelogIdByText.get(text);
      return <h1 id={id}>{children}</h1>;
    },
    h2: ({ children }: { children?: React.ReactNode }) => {
      const text = textFromNode(children).trim();
      const id = changelogIdByText.get(text);
      return <h2 id={id}>{children}</h2>;
    },
  };

  const showToc = Boolean(aboutH1 || changelogH1);

  // Issue #620 follow-up: keep the content column horizontally aligned with
  // the Docs page so switching tabs doesn't shift the text. Docs uses a
  // 3-column grid `[nav | content | toc]` at xl. About has no left nav, so
  // we mirror that grid with an empty placeholder in slot 1 — the centered
  // content column then lines up byte-for-byte with Docs.
  //
  // At md/lg About stays single-column (the right-rail TOC is `hidden
  // xl:block`, so adding a second column there would render an empty
  // placeholder column). The outer `mx-auto` on the content child keeps
  // it centered at those breakpoints.
  return (
    <div className="w-full py-6">
      <div
        className={
          showToc
            ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(8rem,1fr)_minmax(0,42rem)_minmax(8rem,1fr)]"
            : "grid grid-cols-1 gap-6"
        }
      >
        {showToc && (
          <div className="hidden xl:block" aria-hidden />
        )}
        <div className="mx-auto w-full max-w-2xl space-y-10 [&_h1]:scroll-mt-20 [&_h2]:scroll-mt-20">
          {aboutContent ? (
            <article className="prose prose-sm dark:prose-invert max-w-none leading-7">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={aboutMarkdownComponents}
              >
                {aboutContent}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="text-muted-foreground">
              <h1 className="text-2xl font-bold mb-3">About</h1>
              <p>Could not load the About page.</p>
            </div>
          )}

          {changelogContent && (
            <section className="border-t pt-8">
              <article className="prose prose-sm dark:prose-invert max-w-none leading-7">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={changelogMarkdownComponents}
                >
                  {changelogContent}
                </ReactMarkdown>
              </article>
            </section>
          )}
        </div>

        {showToc && aboutH1 && changelogH1 && (
          <AboutToc
            about={{ id: aboutH1.id, label: "About" }}
            changelog={{ id: changelogH1.id, label: "Changelog", versions }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Recursively flatten a ReactMarkdown heading's children into a plain string.
 * Mirrors the helper used by the docs renderer; small enough to live alongside.
 */
function textFromNode(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textFromNode((node as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}
