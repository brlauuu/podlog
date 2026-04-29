import { readFile } from "fs/promises";
import { join } from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

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

export default async function AboutPage() {
  const [aboutContent, changelogContent] = await Promise.all([
    readDocOrNull("about.md"),
    readDocOrNull("CHANGELOG.md"),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl py-4 space-y-10">
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
              components={markdownComponents}
            >
              {changelogContent}
            </ReactMarkdown>
          </article>
        </section>
      )}
    </div>
  );
}
