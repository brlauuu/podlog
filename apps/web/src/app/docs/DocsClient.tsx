"use client";

import { type ReactNode, useState, useEffect, useMemo } from "react";
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

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
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

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function makeUniqueSlugger() {
  const slugCounts = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text) || "section";
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

export function extractTocItems(markdown: string): TocItem[] {
  const getUniqueSlug = makeUniqueSlugger();
  const items: TocItem[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(##|###)\s+(.+)$/);
    if (!match) continue;
    const level = match[1] === "##" ? 2 : 3;
    const text = match[2].trim();
    if (!text) continue;
    items.push({
      id: getUniqueSlug(text),
      text,
      level,
    });
  }
  return items;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textFromNode((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export default function DocsClient({ docs }: DocsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

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
      setActiveHeadingId(null);
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

  const tocItems = useMemo(
    () => (content ? extractTocItems(content) : []),
    [content]
  );

  useEffect(() => {
    if (!tocItems.length) {
      setActiveHeadingId(null);
      return;
    }

    const updateActiveHeading = () => {
      const topOffset = 120;
      let active = tocItems[0]?.id ?? null;
      for (const item of tocItems) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - topOffset <= 0) {
          active = item.id;
        } else {
          break;
        }
      }
      setActiveHeadingId(active);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [tocItems]);

  const renderHeadingId = makeUniqueSlugger();

  return (
    <div className="w-full py-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_240px]">
      {/* Sidebar / mobile navigator */}
      <aside className="w-full md:w-[220px] md:shrink-0">
        <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Knowledge base</h2>
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
        <nav className="hidden space-y-1 md:block md:sticky md:top-20">
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
          <article className="prose prose-sm dark:prose-invert max-w-none leading-7">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                h2: ({ children }) => {
                  const text = textFromNode(children).trim();
                  const id = renderHeadingId(text);
                  return <h2 id={id}>{children}</h2>;
                },
                h3: ({ children }) => {
                  const text = textFromNode(children).trim();
                  const id = renderHeadingId(text);
                  return <h3 id={id}>{children}</h3>;
                },
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

      <aside className="hidden xl:block">
        <div className="sticky top-20">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">On this page</h2>
          {tocItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sections</p>
          ) : (
            <nav className="space-y-1">
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`block text-sm transition-colors hover:text-foreground ${
                    item.level === 3 ? "ml-3 text-muted-foreground" : ""
                  } ${
                    activeHeadingId === item.id
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {item.text}
                </a>
              ))}
            </nav>
          )}
        </div>
      </aside>
      </div>
    </div>
  );
}
