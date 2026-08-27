import type { DocSection } from "./docs-search";

/** At most this many sections go to the model. */
export const MAX_SECTIONS = 8;

/**
 * Character budget expressed in tokens, at the usual ~4 chars/token.
 *
 * The smallest supported local model is qwen2.5:3b at 8192 context
 * (rag.py::MODEL_NUM_CTX), shared with the system prompt and the
 * conversation history, so 4000 leaves room for both.
 */
export const MAX_CONTEXT_TOKENS = 4000;

const CHARS_PER_TOKEN = 4;

/**
 * Words carrying no retrieval signal. Without this, "what is the..." scores
 * nearly every section in the corpus equally and the ranking is noise.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "should", "that", "the", "then", "there", "these", "this", "to",
  "was", "what", "when", "where", "which", "why", "will", "with", "you", "your",
]);

/** Distinct, meaningful lowercase terms from a question. */
function terms(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  );
}

/** A heading names its subject, so a title hit is worth more than a body hit. */
const TITLE_WEIGHT = 3;
const CONTENT_WEIGHT = 1;

function scoreSection(section: DocSection, qTerms: string[]): number {
  const title = section.sectionTitle.toLowerCase();
  const body = section.content.toLowerCase();
  let score = 0;
  for (const t of qTerms) {
    if (title.includes(t)) score += TITLE_WEIGHT;
    if (body.includes(t)) score += CONTENT_WEIGHT;
  }
  return score;
}

/**
 * Pick the documentation sections most likely to answer `question` (#990).
 *
 * Deliberately not `searchIndex` from docs-search.ts. That matches the whole
 * query as one substring -- correct for the docs search box, and useless
 * here, because "why is Whisper unloaded before pyannote" is not a substring
 * of any section. This scores individual terms instead.
 *
 * Retrieval is keyword-based on purpose: the corpus is small, lives in git,
 * and changes on almost every PR, so an embedding index would add a
 * staleness failure that is silent. The seam is narrow enough that
 * embeddings could replace the scorer later without touching callers.
 */
export function selectSections(
  question: string,
  index: DocSection[],
  opts: { maxSections?: number; maxTokens?: number } = {},
): DocSection[] {
  const maxSections = opts.maxSections ?? MAX_SECTIONS;
  const maxChars = (opts.maxTokens ?? MAX_CONTEXT_TOKENS) * CHARS_PER_TOKEN;

  const qTerms = terms(question);
  if (qTerms.length === 0 || index.length === 0) return [];

  const scored = index
    .map((section) => ({ section, score: scoreSection(section, qTerms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break, matching docs-search.ts's convention so two
      // equally relevant sections always come back in the same order.
      if (a.section.docSlug !== b.section.docSlug) {
        return a.section.docSlug.localeCompare(b.section.docSlug);
      }
      return a.section.sectionId.localeCompare(b.section.sectionId);
    });

  const out: DocSection[] = [];
  let chars = 0;
  for (const { section } of scored) {
    if (out.length >= maxSections) break;
    const cost = section.content.length;
    // Skip rather than stop: a single oversized section must not deny the
    // budget to every shorter one behind it.
    if (chars + cost > maxChars) continue;
    out.push(section);
    chars += cost;
  }
  return out;
}

const REPO_BLOB_BASE_URL = "https://github.com/brlauuu/podlog/blob/main";

/**
 * Where a cited section lives (#990).
 *
 * Guide pages are rendered at /docs and get a deep link to the exact
 * heading. PRDs and reference docs have no rendered surface in the app, so
 * they cite to the repository instead -- the same convention DocsClient
 * already uses for links that leave the rendered guide.
 */
export function citationHref(
  source: string,
  slug: string,
  anchor: string | null,
  repoPath: string,
): string {
  if (source === "guide") {
    return `/docs?page=${encodeURIComponent(slug)}${anchor ? `#${anchor}` : ""}`;
  }
  return `${REPO_BLOB_BASE_URL}/${repoPath}`;
}

/** Human label for where a citation came from. */
export function citationSourceLabel(source: string): string {
  if (source === "guide") return "guide";
  if (source === "prd") return "design doc";
  return "reference";
}
