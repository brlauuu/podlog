/**
 * Pure helpers for client-side docs keyword search.
 *
 * The index is built server-side in @/lib/docs-index and shipped to the
 * client via DocsPage props. These helpers run in the browser to filter
 * the corpus and produce the snippet UI.
 */

export interface DocSection {
  /** Filename without extension, e.g. "06-speakers". Matches DocEntry.name. */
  docSlug: string;
  /** Human-readable doc title, e.g. "Speakers". */
  docTitle: string;
  /** Heading anchor id (matches DocsClient's slugifyHeading + makeUniqueSlugger). */
  sectionId: string;
  /** Heading text, e.g. "Renaming a speaker". Empty string for content before the first heading. */
  sectionTitle: string;
  /** Heading level, 2 for ##, 3 for ###. 0 means "before any heading" (preamble). */
  level: 0 | 2 | 3;
  /** Section body, raw markdown text. */
  content: string;
}

export interface SearchHit {
  section: DocSection;
  /** Where the match was found — drives ranking. */
  matchedIn: "title" | "content";
  /** Index of the first match within the searched string (lowercased). */
  matchIndex: number;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/**
 * Filter the index by query and return ranked hits.
 *
 * Ranking:
 *   1) section-title matches first (most discoverable)
 *   2) then content matches
 *   3) within each tier, hits with an earlier match position rank higher
 *   4) ties broken by docSlug then sectionId for determinism
 *
 * Empty / whitespace-only queries return [].
 */
export function searchIndex(query: string, index: DocSection[]): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  for (const section of index) {
    const titleIdx = section.sectionTitle.toLowerCase().indexOf(q);
    if (titleIdx !== -1) {
      hits.push({ section, matchedIn: "title", matchIndex: titleIdx });
      continue;
    }
    const contentIdx = section.content.toLowerCase().indexOf(q);
    if (contentIdx !== -1) {
      hits.push({ section, matchedIn: "content", matchIndex: contentIdx });
    }
  }

  hits.sort((a, b) => {
    if (a.matchedIn !== b.matchedIn) return a.matchedIn === "title" ? -1 : 1;
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    if (a.section.docSlug !== b.section.docSlug) {
      return a.section.docSlug.localeCompare(b.section.docSlug);
    }
    return a.section.sectionId.localeCompare(b.section.sectionId);
  });

  return hits;
}

/**
 * Build a snippet around the first match in `content`. Trims to roughly
 * `halfWidth` characters on either side, snapping at word boundaries when
 * possible to avoid mid-word cuts.
 */
export function makeSnippet(content: string, query: string, halfWidth = 60): Snippet {
  const q = query.toLowerCase();
  const idx = content.toLowerCase().indexOf(q);
  if (idx === -1 || !q) {
    const head = content.slice(0, halfWidth * 2);
    return { before: head, match: "", after: content.length > head.length ? "…" : "" };
  }

  const matchEnd = idx + q.length;
  const rawBeforeStart = Math.max(0, idx - halfWidth);
  const rawAfterEnd = Math.min(content.length, matchEnd + halfWidth);

  // Snap left edge to a whitespace boundary if we're not already at the start.
  let beforeStart = rawBeforeStart;
  if (beforeStart > 0) {
    const ws = content.indexOf(" ", beforeStart);
    if (ws !== -1 && ws < idx) beforeStart = ws + 1;
  }
  // Snap right edge similarly.
  let afterEnd = rawAfterEnd;
  if (afterEnd < content.length) {
    const ws = content.lastIndexOf(" ", afterEnd);
    if (ws > matchEnd) afterEnd = ws;
  }

  const before = (beforeStart > 0 ? "…" : "") + content.slice(beforeStart, idx);
  const match = content.slice(idx, matchEnd);
  const after = content.slice(matchEnd, afterEnd) + (afterEnd < content.length ? "…" : "");
  // Collapse newlines to spaces for compact display.
  return {
    before: before.replace(/\s+/g, " "),
    match,
    after: after.replace(/\s+/g, " "),
  };
}
