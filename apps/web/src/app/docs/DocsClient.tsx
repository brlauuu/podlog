"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface DocEntry {
  name: string;        // filename without extension, e.g. "01-installation"
  title: string;       // display title, e.g. "Installation"
}

interface DocsClientProps {
  docs: DocEntry[];
}

export default function DocsClient({ docs }: DocsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currentPage = searchParams.get("page") || "README";

  // Fetch doc content when page changes
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/docs/${currentPage}`);
        if (resp.ok) {
          setContent(await resp.text());
        } else {
          setContent(null);
        }
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, [currentPage]);

  // Transform internal .md links to ?page= query params
  const transformLink = (href: string | undefined): string | undefined => {
    if (!href || !href.endsWith(".md")) return href;
    const name = href.replace(/\.md$/, "");
    return `?page=${name}`;
  };

  return (
    <div className="flex gap-6 max-w-6xl mx-auto px-4 py-6">
      {/* Sidebar */}
      <aside className="w-52 shrink-0">
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-2">Guide</h2>
        <nav className="space-y-1">
          {docs.map((doc) => (
            <button
              key={doc.name}
              onClick={() => router.push(`/docs?page=${doc.name}`)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                currentPage === doc.name
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {doc.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {loading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : content ? (
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children }) => (
                  <a href={transformLink(href as string | undefined)}>
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="text-muted-foreground">
            <h1 className="text-2xl font-bold mb-4">Documentation</h1>
            <p>Could not load the requested page.</p>
          </div>
        )}
      </main>
    </div>
  );
}
