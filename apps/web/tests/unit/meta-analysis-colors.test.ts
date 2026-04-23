import { colorForFeed, FEED_COLOR_PALETTE } from "@/lib/metaAnalysisColors";

describe("colorForFeed", () => {
  it("returns a palette color for any feed_id", () => {
    const color = colorForFeed("abc-123");
    expect(FEED_COLOR_PALETTE).toContain(color);
  });

  it("is deterministic across calls", () => {
    const a = colorForFeed("feed-xyz");
    const b = colorForFeed("feed-xyz");
    expect(a).toBe(b);
  });

  it("spreads UUID-shaped ids across most of the palette", () => {
    // Generate 200 deterministic UUID-like strings (varying the last segment
    // only — varying both ends correlates inputs and defeats FNV avalanche)
    // and check that the hash exercises at least 7 of the 10 buckets.
    const colors = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = `00000000-1234-5678-9abc-${i.toString(16).padStart(12, "0")}`;
      colors.add(colorForFeed(id));
    }
    expect(colors.size).toBeGreaterThanOrEqual(7);
  });

  it("does not heavily favor a single bucket on UUID-shaped ids", () => {
    // For 200 UUID-like ids, no single color should claim more than ~30%
    // of assignments. Even chi-square-uniform distribution gives 10%/bucket;
    // 30% catches gross modulo bias without being flaky.
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const id = `00000000-1234-5678-9abc-${i.toString(16).padStart(12, "0")}`;
      const c = colorForFeed(id);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const max = Math.max(...counts.values());
    expect(max).toBeLessThanOrEqual(60); // 30% of 200
  });
});
