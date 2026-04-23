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

  it("distributes different feed_ids across the palette (not all same)", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(colorForFeed(`feed-${i}`));
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});
