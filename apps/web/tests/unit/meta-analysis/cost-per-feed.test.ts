import { buildCostPerFeed } from "@/app/meta-analysis/charts/transforms/costPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A", total_cost_usd: 5.5 } as PerFeed,
  { feed_id: "b", title: "B", total_cost_usd: 0 } as PerFeed,
  { feed_id: "c", title: "C", total_cost_usd: 12.3 } as PerFeed,
];

describe("buildCostPerFeed", () => {
  it("drops zero-cost feeds and sorts desc", () => {
    const rows = buildCostPerFeed(FEEDS);
    expect(rows.map((r) => r.title)).toEqual(["C", "A"]);
  });
});
