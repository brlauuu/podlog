import type { PerFeed } from "@/lib/metaAnalysisTypes";
import { colorForFeed } from "@/lib/metaAnalysisColors";

export interface CostBar { feed_id: string; title: string; cost: number; color: string; }

export function buildCostPerFeed(feeds: PerFeed[]): CostBar[] {
  return feeds
    .filter((f) => f.total_cost_usd > 0)
    .map((f) => ({
      feed_id: f.feed_id, title: f.title, cost: f.total_cost_usd,
      color: colorForFeed(f.feed_id),
    }))
    .sort((a, b) => b.cost - a.cost);
}
