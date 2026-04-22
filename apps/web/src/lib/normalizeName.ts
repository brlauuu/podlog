/**
 * Normalize a person's display name for dedupe — mirrors
 * apps/pipeline/app/services/inference_helpers.py::normalize_name.
 *
 * Lowercase, collapse whitespace, and strip leading honorifics so
 * "Dr. Jane Smith" and "Jane Smith" compare as the same person.
 *
 * Keep in sync with the Python helper: same honorific set, same rules.
 */
const HONORIFICS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "mx",
  "prof",
  "sir",
  "madam",
  "rev",
  "fr",
  "sr",
  "st",
]);

export function normalizeName(name: string): string {
  const lowered = name.toLowerCase().trim().split(/\s+/).join(" ");
  if (!lowered) return lowered;
  const tokens = lowered.split(" ");
  while (tokens.length > 1) {
    const head = tokens[0].replace(/[.,:]+$/, "");
    if (HONORIFICS.has(head)) {
      tokens.shift();
    } else {
      break;
    }
  }
  return tokens.join(" ");
}
