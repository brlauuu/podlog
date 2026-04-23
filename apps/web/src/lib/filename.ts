/**
 * Unicode-safe filename sanitization for client-side exports.
 *
 * Strips only filesystem-reserved characters; preserves letters and digits
 * from all scripts (đ, Đ, ć, č, š, ž, ü, ö, etc.) so exported filenames
 * match the source title for non-English content.
 *
 * Used by TranscriptExportButton, EpisodeChat (conversation export), and
 * DownloadReportButton (search report export). If a Python counterpart is
 * ever added (none today — pipeline writes `{uuid}.txt`), mirror the rules
 * here to keep cross-runtime filenames consistent.
 */

export interface SanitizeFilenameOptions {
  maxLength?: number;
  separator?: string;
  fallback?: string;
}

// Excludes \t (\x09), \n (\x0a), \r (\x0d) so they survive long enough
// to be collapsed into the separator by the next pass.
const RESERVED_CHARS_RE = /[/\\:*?"<>|\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

function trimEdges(value: string, separator: string): string {
  const isTrimChar = (ch: string): boolean =>
    ch === "." || ch === " " || ch === "\t" || ch === separator;
  let start = 0;
  let end = value.length;
  while (start < end && isTrimChar(value[start])) start++;
  while (end > start && isTrimChar(value[end - 1])) end--;
  return value.slice(start, end);
}

export function sanitizeFilename(
  name: string,
  options: SanitizeFilenameOptions = {},
): string {
  const maxLength = options.maxLength ?? 100;
  const separator = options.separator ?? "-";
  const fallback = options.fallback ?? "untitled";

  let result = (name ?? "").normalize("NFC");
  result = result.replace(RESERVED_CHARS_RE, "");
  result = result.replace(/\s+/g, separator);
  if (separator.length > 0) {
    const sepRunRe = new RegExp(`(?:${escapeRegex(separator)}){2,}`, "g");
    result = result.replace(sepRunRe, separator);
  }
  result = trimEdges(result, separator);

  const chars = Array.from(result);
  if (chars.length > maxLength) {
    result = trimEdges(chars.slice(0, maxLength).join(""), separator);
  }

  return result || fallback;
}
