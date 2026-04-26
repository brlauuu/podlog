/**
 * Heading-slug utilities shared by:
 *   - The docs renderer in @/app/docs/DocsClient (per-render, browser).
 *   - The docs search indexer in @/lib/docs-index (per-request, server).
 *
 * Both sides MUST use the same algorithm so search results' anchor links
 * resolve to the IDs the renderer actually puts into the DOM.
 */

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Returns a function that produces unique slugs for a stream of headings,
 * appending `-1`, `-2`, ... to disambiguate repeats. State is per-instance
 * so each document/render starts fresh.
 */
export function makeUniqueSlugger(): (text: string) => string {
  const slugCounts = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text) || "section";
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
