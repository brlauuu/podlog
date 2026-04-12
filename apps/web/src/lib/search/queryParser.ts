export type SearchExecutionMode = "transcript_hybrid" | "metadata_only";

export interface ParsedSearchQuery {
  raw: string;
  freeText: string;
  titleFilter: string | null;
  descriptionFilter: string | null;
  speakerFilter: string | null;
  mode: SearchExecutionMode;
}

const SCOPE_PATTERN = /\b(title|description|speaker)\s*:/gi;

function normalizeValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"')) {
    const unwrapped = trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed.slice(1);
    const cleaned = unwrapped.trim();
    return cleaned || null;
  }
  return trimmed;
}

function appendScopedValue(existing: string | null, next: string | null): string | null {
  if (!next) return existing;
  if (!existing) return next;
  return `${existing} ${next}`;
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const input = raw.trim();
  const freeTextParts: string[] = [];

  let titleFilter: string | null = null;
  let descriptionFilter: string | null = null;
  let speakerFilter: string | null = null;

  const matches = Array.from(input.matchAll(SCOPE_PATTERN));
  if (matches.length === 0) {
    return {
      raw,
      freeText: input,
      titleFilter,
      descriptionFilter,
      speakerFilter,
      mode: "transcript_hybrid",
    };
  }

  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const scopeName = (match[1] ?? "").toLowerCase();
    const scopeStart = match.index ?? 0;
    const valueStart = scopeStart + match[0].length;
    const nextScopeStart = i + 1 < matches.length ? (matches[i + 1].index ?? input.length) : input.length;

    if (scopeStart > cursor) {
      freeTextParts.push(input.slice(cursor, scopeStart).trim());
    }

    const rawValue = input.slice(valueStart, nextScopeStart);
    const normalized = normalizeValue(rawValue);
    if (normalized) {
      if (scopeName === "title") titleFilter = appendScopedValue(titleFilter, normalized);
      if (scopeName === "description") descriptionFilter = appendScopedValue(descriptionFilter, normalized);
      if (scopeName === "speaker") speakerFilter = appendScopedValue(speakerFilter, normalized);
      cursor = nextScopeStart;
      continue;
    }

    // Empty scoped value: treat the whole token as free text so it stays searchable.
    const tokenText = input.slice(scopeStart, nextScopeStart).trim();
    if (tokenText) freeTextParts.push(tokenText);
    cursor = nextScopeStart;
  }

  if (cursor < input.length) {
    freeTextParts.push(input.slice(cursor).trim());
  }

  const freeText = freeTextParts.filter(Boolean).join(" ").trim();
  const hasScopedFilters = Boolean(titleFilter || descriptionFilter || speakerFilter);
  const mode: SearchExecutionMode = !freeText && hasScopedFilters ? "metadata_only" : "transcript_hybrid";

  return {
    raw,
    freeText,
    titleFilter,
    descriptionFilter,
    speakerFilter,
    mode,
  };
}

export function buildNormalizedQuery(parsed: ParsedSearchQuery): string {
  if (parsed.freeText) return parsed.freeText;
  const scopedParts = [parsed.titleFilter, parsed.descriptionFilter, parsed.speakerFilter].filter(
    (part): part is string => Boolean(part)
  );
  return scopedParts.join(" ").trim();
}
