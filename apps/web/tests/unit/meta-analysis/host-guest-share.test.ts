import { buildHostGuestShare } from "@/app/meta-analysis/charts/transforms/hostGuestShare";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", host_share: 0.7 } as PerEpisode,
  { episode_id: "2", feed_id: "a", host_share: 0.6 } as PerEpisode,
  { episode_id: "3", feed_id: "a", host_share: null } as PerEpisode,  // excluded
  { episode_id: "4", feed_id: "b", host_share: 0.4 } as PerEpisode,
];
const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

describe("buildHostGuestShare", () => {
  it("averages host_share per feed ignoring nulls", () => {
    const rows = buildHostGuestShare(EPS, FEEDS);
    const a = rows.find((r) => r.feed_id === "a")!;
    expect(a.host_pct).toBeCloseTo(65);
    expect(a.guest_pct).toBeCloseTo(35);
  });

  it("omits feeds with no included episodes", () => {
    const rows = buildHostGuestShare(
      [{ episode_id: "x", feed_id: "a", host_share: null } as PerEpisode],
      FEEDS
    );
    expect(rows).toHaveLength(0);
  });
});
