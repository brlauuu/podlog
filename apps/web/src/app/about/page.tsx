import { readFile } from "fs/promises";
import { join } from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import ChangelogToc, { type ChangelogTocItem } from "@/components/ChangelogToc";
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

/**
 * Pull the changelog's version-section H2s — lines like
 * `## [0.3.0] — 2026-04-24` or `## [Unreleased]`. Skips other H2s
 * (e.g. the contribution-flow comment helper if one is ever added).
 *
 * Pairs each entry with the slug the markdown renderer will produce so
 * the right-rail anchor links resolve to real DOM ids.
 */
function extractChangelogVersions(markdown: string): ChangelogTocItem[] {
  // Slug every H2, but only emit version-shaped ones. Slugging every heading
  // keeps this slugger's collision counts in lockstep with the renderer's
  // slugger, so the produced ids match what ends up in the DOM even if a
  // non-version H2 (e.g. "## Notes") is added between version sections.
  const slugger = makeUniqueSlugger();
  const out: ChangelogTocItem[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^##\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    const id = slugger(text);
    if (text.startsWith("[")) out.push({ id, text });
  }
  return out;
}

export default async function AboutPage() {
  const [aboutContent, changelogContent] = await Promise.all([
    readDocOrNull("about.md"),
    readDocOrNull("CHANGELOG.md"),
  ]);

  const versions = changelogContent ? extractChangelogVersions(changelogContent) : [];

  // The renderer needs a stateful slugger so heading ids are stable and
  // unique across the rendered changelog. Same scheme the docs page uses.
  const renderHeadingId = makeUniqueSlugger();
  const changelogComponents = {
    ...markdownComponents,
    h2: ({ children }: { children?: React.ReactNode }) => {
      const text = textFromNode(children).trim();
      const id = renderHeadingId(text);
      return <h2 id={id}>{children}</h2>;
    },
  };

  return (
    <div className="mx-auto w-full max-w-7xl py-4">
      <div
        className={`grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,42rem)_minmax(8rem,1fr)] ${versions.length === 0 ? "xl:grid-cols-1" : ""} xl:justify-center`}
      >
        <div className="mx-auto w-full max-w-2xl space-y-10 xl:mx-0">
          {aboutContent ? (
            <article className="prose prose-sm dark:prose-invert max-w-none leading-7">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={markdownComponents}
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
                  components={changelogComponents}
                >
                  {changelogContent}
                </ReactMarkdown>
              </article>
            </section>
          )}
        </div>

        <ChangelogToc items={versions} />
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
