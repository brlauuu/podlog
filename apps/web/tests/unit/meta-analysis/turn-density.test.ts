import { buildTurnDensity } from "@/app/meta-analysis/charts/transforms/turnDensity";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", duration_secs: 600, turn_count: 20 } as PerEpisode,
  { episode_id: "2", feed_id: "a", duration_secs: 0, turn_count: 0 } as PerEpisode,  // skip
];

describe("buildTurnDensity", () => {
  it("yields {duration_min, turns_per_min, feed_id} per episode", () => {
    const rows = buildTurnDensity(EPS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ duration_min: 10, turns_per_min: 2, feed_id: "a" });
  });
});
