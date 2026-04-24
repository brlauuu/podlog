import { buildTokensPerEpisode } from "@/app/meta-analysis/charts/transforms/tokensPerEpisode";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", published_at: "2026-01-01T00:00:00Z",
    token_count_segments: 10000, token_count_chunks: 9500 } as PerEpisode,
  { episode_id: "2", feed_id: "a", published_at: "2026-02-01T00:00:00Z",
    token_count_segments: 12000, token_count_chunks: 11000 } as PerEpisode,
];

describe("buildTokensPerEpisode", () => {
  it("orders chronologically and exposes both counts", () => {
    const rows = buildTokensPerEpisode(EPS);
    expect(rows).toHaveLength(2);
    expect(rows[0].segments).toBe(10000);
    expect(rows[0].chunks).toBe(9500);
    expect(rows[1].segments).toBe(12000);
  });
});
