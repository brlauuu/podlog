/**
 * Tiny semver comparator for the footer's stale-build check (#744).
 *
 * Avoids pulling in the full `semver` npm dep for a single comparison.
 * Parses `MAJOR.MINOR.PATCH` triples (extra pre-release / build
 * metadata after the patch is tolerated but ignored for ordering
 * — fine for our 0.x.y world; revisit when we hit 1.0.0 and start
 * caring about pre-release ordering).
 */
export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a `MAJOR.MINOR.PATCH...` string. Returns null when the input
 * isn't shaped like a semver (missing components, non-numeric pieces).
 * Leading "v" is tolerated.
 */
export function parseSemver(text: string): SemverParts | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim().replace(/^v/i, "");
  // Match a leading MAJOR.MINOR.PATCH; ignore whatever follows (pre-release,
  // build metadata, trailing whitespace).
  const m = trimmed.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
    patch: Number.parseInt(m[3], 10),
  };
}

/**
 * Numeric three-part compare. Returns:
 *   -1 if `a < b`
 *    0 if equal
 *    1 if `a > b`
 *
 * Either side null → 0 (treat as equal so callers don't false-alarm
 * when the input is malformed). Callers that need to distinguish
 * "couldn't compare" should check parseSemver explicitly first.
 */
export function compareSemver(
  a: SemverParts | null,
  b: SemverParts | null,
): -1 | 0 | 1 {
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Convenience: true when `onDisk` is strictly newer than `builtIn`
 * (i.e. the running image is stale relative to what's on disk).
 * False on any parse failure.
 */
export function isOnDiskNewer(onDisk: string | null, builtIn: string | null): boolean {
  if (!onDisk || !builtIn) return false;
  const a = parseSemver(builtIn);
  const b = parseSemver(onDisk);
  if (!a || !b) return false;
  return compareSemver(b, a) === 1;
}
