/**
 * Tests for the tiny semver comparator used by the footer's stale-build
 * check (#744).
 */
import { compareSemver, isOnDiskNewer, parseSemver } from "@/lib/semver";

describe("parseSemver", () => {
  it("parses MAJOR.MINOR.PATCH", () => {
    expect(parseSemver("0.4.6")).toEqual({ major: 0, minor: 4, patch: 6 });
    expect(parseSemver("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("tolerates leading 'v'", () => {
    expect(parseSemver("v0.4.6")).toEqual({ major: 0, minor: 4, patch: 6 });
    expect(parseSemver("V1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores pre-release / build suffix", () => {
    expect(parseSemver("0.4.6-pre")).toEqual({ major: 0, minor: 4, patch: 6 });
    expect(parseSemver("1.0.0+build.5")).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("returns null for malformed input", () => {
    expect(parseSemver("not a version")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver(null as unknown as string)).toBeNull();
  });
});

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(
      compareSemver(parseSemver("0.4.6"), parseSemver("0.4.6")),
    ).toBe(0);
  });

  it("compares major", () => {
    expect(
      compareSemver(parseSemver("0.9.9"), parseSemver("1.0.0")),
    ).toBe(-1);
    expect(
      compareSemver(parseSemver("2.0.0"), parseSemver("1.99.99")),
    ).toBe(1);
  });

  it("compares minor when major is equal", () => {
    expect(
      compareSemver(parseSemver("0.3.9"), parseSemver("0.4.0")),
    ).toBe(-1);
    // The 10-vs-9 case that breaks naive string compare.
    expect(
      compareSemver(parseSemver("0.9.0"), parseSemver("0.10.0")),
    ).toBe(-1);
  });

  it("compares patch when major and minor are equal", () => {
    expect(
      compareSemver(parseSemver("0.4.5"), parseSemver("0.4.6")),
    ).toBe(-1);
    // Also exercises the patch-level 10-vs-9 case.
    expect(
      compareSemver(parseSemver("0.4.9"), parseSemver("0.4.10")),
    ).toBe(-1);
  });

  it("returns 0 when either side is null", () => {
    expect(compareSemver(null, parseSemver("1.0.0"))).toBe(0);
    expect(compareSemver(parseSemver("1.0.0"), null)).toBe(0);
    expect(compareSemver(null, null)).toBe(0);
  });
});

describe("isOnDiskNewer", () => {
  it("true when on-disk is strictly newer", () => {
    expect(isOnDiskNewer("0.4.6", "0.3.0")).toBe(true);
    expect(isOnDiskNewer("1.0.0", "0.10.5")).toBe(true);
  });

  it("false when equal", () => {
    expect(isOnDiskNewer("0.4.6", "0.4.6")).toBe(false);
  });

  it("false when on-disk is older (downgrade / branch checkout)", () => {
    expect(isOnDiskNewer("0.3.0", "0.4.6")).toBe(false);
  });

  it("false on any parse failure (silent)", () => {
    expect(isOnDiskNewer("not a version", "0.4.6")).toBe(false);
    expect(isOnDiskNewer("0.4.6", "garbage")).toBe(false);
    expect(isOnDiskNewer(null, "0.4.6")).toBe(false);
    expect(isOnDiskNewer("0.4.6", null)).toBe(false);
  });
});
