/**
 * Drop elements that only belong in <head> from a rehype (hast) tree (#1059).
 *
 * The About and Docs pages render Markdown with `rehype-raw`, so any raw HTML
 * in the source becomes real elements. React 19 hoists <title>, <meta> and
 * <link> rendered anywhere in the tree into the document head. A changelog
 * entry that mentioned a bare `<title>` in prose therefore renamed the
 * browser tab to the words that followed it. Markdown content has no
 * business setting the document title, metadata, styles or scripts, so
 * those elements are removed wherever they appear.
 */
const STRIP = new Set(["title", "meta", "link", "base", "script", "style", "head"]);

interface HastNode {
  type: string;
  tagName?: string;
  children?: HastNode[];
}

function strip(node: HastNode): void {
  if (!node.children) return;
  node.children = node.children.filter(
    (child) => !(child.type === "element" && child.tagName && STRIP.has(child.tagName)),
  );
  for (const child of node.children) strip(child);
}

export default function rehypeStripHead() {
  return (tree: HastNode) => {
    strip(tree);
  };
}
