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

const REPO_BLOB_BASE_URL = "https://github.com/brlauuu/podlog/blob/main";

function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function resolveRelativePath(baseParts: string[], relativePath: string): string[] | null {
  const resolved = [...baseParts];
  const pathParts = relativePath.split("/").filter(Boolean);

  for (const part of pathParts) {
    if (part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved;
}

export function resolveMarkdownHref(href: string | undefined, docs: DocEntry[]): string | undefined {
  if (!href) return href;
  if (href.startsWith("#")) return href;
  if (isExternalUrl(href) || href.startsWith("/")) return href;

  const [rawPath, hash = ""] = href.split("#");
  const normalizedPath = rawPath.replace(/\\/g, "/");

  if (!normalizedPath.endsWith(".md")) return href;

  const resolvedParts = resolveRelativePath(["docs", "guide"], normalizedPath);
  if (!resolvedParts || resolvedParts.length === 0) return href;

  const repoPath = resolvedParts.join("/");
  const filename = resolvedParts[resolvedParts.length - 1];
  const slug = filename.replace(/\.md$/, "");
  const hashSuffix = hash ? `#${hash}` : "";

  if (repoPath.startsWith("docs/guide/") && docs.some((doc) => doc.name === slug)) {
    return `/docs?page=${encodeURIComponent(slug)}${hashSuffix}`;
  }

  return `${REPO_BLOB_BASE_URL}/${repoPath}${hashSuffix}`;
}

export default function DocsClient({ docs }: DocsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestedPage = searchParams.get("page");
  const defaultPage = docs.find((doc) => doc.name === "README")?.name ?? docs[0]?.name ?? null;
  const currentPage = docs.some((doc) => doc.name === requestedPage)
    ? requestedPage
    : defaultPage;

  useEffect(() => {
    if (!docs.length) return;
    if (requestedPage && docs.some((doc) => doc.name === requestedPage)) return;
    if (!currentPage) return;
    router.replace(`/docs?page=${encodeURIComponent(currentPage)}`);
  }, [docs, requestedPage, currentPage, router]);

  // Fetch doc content when page changes
  useEffect(() => {
    if (!currentPage) {
      setContent(null);
      setLoading(false);
      return;
    }

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

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6 max-w-6xl mx-auto px-4 py-6">
      {/* Sidebar / mobile navigator */}
      <aside className="w-full md:w-52 md:shrink-0">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2 px-1">Guide</h2>
        <div className="md:hidden">
          <label htmlFor="docs-page-select" className="sr-only">Choose document</label>
          <select
            id="docs-page-select"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={currentPage ?? ""}
            onChange={(e) => router.push(`/docs?page=${encodeURIComponent(e.target.value)}`)}
            disabled={!docs.length}
          >
            {docs.length === 0 ? (
              <option value="">No documents available</option>
            ) : (
              docs.map((doc) => (
                <option key={doc.name} value={doc.name}>
                  {doc.title}
                </option>
              ))
            )}
          </select>
        </div>
        <nav className="hidden md:block space-y-1">
          {docs.map((doc) => (
            <button
              key={doc.name}
              onClick={() => router.push(`/docs?page=${encodeURIComponent(doc.name)}`)}
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
        {docs.length === 0 ? (
          <div className="text-muted-foreground">
            <h1 className="text-2xl font-bold mb-3">Documentation</h1>
            <p className="mb-2">No markdown docs were found.</p>
            <p>
              Ensure `docs/guide` is available in this environment (for Docker web container,
              mount it at <code>/docs/guide</code>).
            </p>
          </div>
        ) : loading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : content ? (
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children }) => {
                  const resolvedHref = resolveMarkdownHref(href as string | undefined, docs);
                  const external = typeof resolvedHref === "string" && isExternalUrl(resolvedHref);
                  return (
                    <a
                      href={resolvedHref}
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
            <h1 className="text-2xl font-bold mb-3">Documentation</h1>
            <p className="mb-3">Could not load the requested page.</p>
            {defaultPage && (
              <button
                type="button"
                onClick={() => router.push(`/docs?page=${encodeURIComponent(defaultPage)}`)}
                className="text-sm px-3 py-1.5 rounded-md border border-input hover:bg-accent transition-colors"
              >
                Open default page
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
