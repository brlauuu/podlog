import { buildReleaseTimeline } from "@/app/meta-analysis/charts/transforms/releaseTimeline";
import type { TimelineMonthly, PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

const TL: TimelineMonthly[] = [
  { month: "2026-01", feed_id: "a", episode_count: 3, total_words: 0, total_duration_min: 0 },
  { month: "2026-01", feed_id: "b", episode_count: 2, total_words: 0, total_duration_min: 0 },
  { month: "2026-02", feed_id: "a", episode_count: 4, total_words: 0, total_duration_min: 0 },
];

describe("buildReleaseTimeline", () => {
  it("pivots to {month, feed_id: count, ...}", () => {
    const rows = buildReleaseTimeline(TL, FEEDS);
    expect(rows.find((r) => r.month === "2026-01")).toMatchObject({
      month: "2026-01", a: 3, b: 2,
    });
    expect(rows.find((r) => r.month === "2026-02")).toMatchObject({
      month: "2026-02", a: 4, b: 0,
    });
  });

  it("sorts months ascending", () => {
    const rows = buildReleaseTimeline(TL, FEEDS);
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
  });
});
