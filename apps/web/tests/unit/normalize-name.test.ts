/**
 * @jest-environment node
 *
 * Keeps apps/web/src/lib/normalizeName.ts in lockstep with
 * apps/pipeline/app/services/inference_helpers.py::normalize_name.
 * Any divergence causes per-feed cache rows to dedupe inconsistently
 * between the web upsert (TS) and Python consumers.
 */
import { normalizeName } from "@/lib/normalizeName";

describe("normalizeName", () => {
  test("lowercases and trims", () => {
    expect(normalizeName("  Alice  ")).toBe("alice");
  });

  test("collapses internal whitespace", () => {
    expect(normalizeName("Jane   Smith")).toBe("jane smith");
    expect(normalizeName("Jane\tSmith")).toBe("jane smith");
  });

  test("strips leading honorific with trailing period", () => {
    expect(normalizeName("Dr. Jane Smith")).toBe("jane smith");
    expect(normalizeName("Mr. Bond")).toBe("bond");
  });

  test("strips leading honorific without punctuation", () => {
    expect(normalizeName("Dr Jane Smith")).toBe("jane smith");
  });

  test("strips multiple consecutive honorifics", () => {
    expect(normalizeName("Dr. Prof. Jane Smith")).toBe("jane smith");
  });

  test("leaves single-token names alone even if honorific", () => {
    // Matches Python: while len(tokens) > 1
    expect(normalizeName("Dr")).toBe("dr");
    expect(normalizeName("Dr.")).toBe("dr.");
  });

  test("does not strip honorific that is not at start", () => {
    expect(normalizeName("Jane Dr Smith")).toBe("jane dr smith");
  });

  test("handles empty and whitespace-only input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
  });

  test("recognizes the same honorific set as Python", () => {
    const honorifics = [
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
    ];
    for (const h of honorifics) {
      expect(normalizeName(`${h}. Jane Smith`)).toBe("jane smith");
    }
  });

  test("is case-insensitive on the honorific", () => {
    expect(normalizeName("DR. Jane Smith")).toBe("jane smith");
    expect(normalizeName("Prof. Jane Smith")).toBe("jane smith");
  });
});
