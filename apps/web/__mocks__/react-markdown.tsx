import React from "react";

// CJS-compatible stub for Jest. The real package is ESM-only.
// Simulates react-markdown's urlTransform: strips non-http(s)/mailto URLs
// unless a custom urlTransform prop passes them through.
function applyUrlTransform(
  url: string,
  customTransform?: (url: string) => string,
): string {
  if (customTransform) return customTransform(url);
  // Mirrors react-markdown's defaultUrlTransform allowlist behavior.
  if (/^(https?|ircs?|mailto|xmpp):/.test(url)) return url;
  if (url.startsWith("#") || url.startsWith("/")) return url;
  return "";
}

export function defaultUrlTransform(url: string): string {
  if (/^(https?|ircs?|mailto|xmpp):/.test(url)) return url;
  if (url.startsWith("#") || url.startsWith("/")) return url;
  return "";
}

export default function ReactMarkdown({
  children,
  components,
  urlTransform: customUrlTransform,
}: {
  children: string;
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;
  remarkPlugins?: unknown[];
  urlTransform?: (url: string) => string;
}) {
  if (!components) return <>{children}</>;

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
    const resolvedHref = applyUrlTransform(match[2], customUrlTransform);
    parts.push(
      <A key={match.index} href={resolvedHref}>
        {match[1]}
      </A>
    );
    last = match.index + match[0].length;
  }
  if (last < children.length) parts.push(children.slice(last));

  return <>{parts}</>;
}
