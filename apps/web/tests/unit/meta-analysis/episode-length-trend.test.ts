import { buildEpisodeLengthTrend } from "@/app/meta-analysis/charts/transforms/episodeLengthTrend";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", published_at: "2026-01-01T00:00:00Z",
    duration_secs: 600 } as PerEpisode,
  { episode_id: "2", feed_id: "a", published_at: "2026-02-01T00:00:00Z",
    duration_secs: 900 } as PerEpisode,
  { episode_id: "3", feed_id: "b", published_at: "2026-01-15T00:00:00Z",
    duration_secs: 1200 } as PerEpisode,
];

describe("buildEpisodeLengthTrend", () => {
  it("groups by feed and orders chronologically", () => {
    const out = buildEpisodeLengthTrend(EPS);
    expect(out.a).toHaveLength(2);
    expect(out.a[0].duration_min).toBe(10);
    expect(out.a[1].duration_min).toBe(15);
    expect(out.b).toHaveLength(1);
  });

  it("drops episodes with no published_at", () => {
    const noPub = [{ episode_id: "x", feed_id: "a", published_at: null,
      duration_secs: 100 } as PerEpisode];
    expect(Object.keys(buildEpisodeLengthTrend(noPub))).toHaveLength(0);
  });
});
