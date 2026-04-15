import { readFile } from "fs/promises";
import { join } from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const aboutPath = join(process.cwd(), "..", "..", "docs", "about.md");

  let content: string | null = null;
  try {
    content = await readFile(aboutPath, "utf-8");
  } catch {
    content = null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      {content ? (
        <article className="prose prose-sm dark:prose-invert max-w-none leading-7">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              a: ({ href, children }) => {
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
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      ) : (
        <div className="text-muted-foreground">
          <h1 className="text-2xl font-bold mb-3">About</h1>
          <p>Could not load the About page.</p>
        </div>
      )}
    </div>
  );
}
