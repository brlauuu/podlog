import React from "react";

// CJS-compatible stub for Jest. The real package is ESM-only.
// Renders children via the custom components map so citation links still resolve.
export default function ReactMarkdown({
  children,
  components,
}: {
  children: string;
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;
  remarkPlugins?: unknown[];
}) {
  if (!components) return <>{children}</>;

  // Minimal link parsing: replace [text](url) with the custom `a` component if provided.
  const A = components["a"] as
    | React.ComponentType<{ href: string; children: React.ReactNode }>
    | undefined;

  if (!A) return <>{children}</>;

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(children)) !== null) {
    if (match.index > last) parts.push(children.slice(last, match.index));
    parts.push(
      <A key={match.index} href={match[2]}>
        {match[1]}
      </A>
    );
    last = match.index + match[0].length;
  }
  if (last < children.length) parts.push(children.slice(last));

  return <>{parts}</>;
}
