/**
 * Tests for the feedShort helper (#747).
 * Hand-curated names pass through; everything else gets a length cap so
 * chart titles and legend entries don't overflow.
 */
import { feedShort } from "@/app/meta-analysis/charts/transforms/feedShort";

describe("feedShort", () => {
  it("returns the curated short name when the title is in the map", () => {
    expect(feedShort("Lenny's Podcast: Product | Career | Growth")).toBe(
      "Lenny's Podcast",
    );
    expect(feedShort("Dwarkesh Podcast")).toBe("Dwarkesh");
  });

  it("passes short unknown titles through unchanged", () => {
    expect(feedShort("Tiny Pod")).toBe("Tiny Pod");
  });

  it("truncates unknown long titles with an ellipsis", () => {
    const long = "Some Very Verbose Podcast Title That Will Overflow";
    const result = feedShort(long);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate titles right at the cap", () => {
    const exact = "Exactly twenty chars"; // length 20
    expect(exact.length).toBe(20);
    expect(feedShort(exact)).toBe(exact);
  });

  it("handles an empty string without throwing", () => {
    expect(feedShort("")).toBe("");
  });

  it("trims trailing whitespace before the ellipsis", () => {
    // 20-char cap; raw slice would land on a space — trim it.
    const input = "AAAAAAAAAAAAAAAAAAA  trailing extras";
    const result = feedShort(input);
    expect(result).not.toMatch(/ …$/);
    expect(result.endsWith("…")).toBe(true);
  });
});
