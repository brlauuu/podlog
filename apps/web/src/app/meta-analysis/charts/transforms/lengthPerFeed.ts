import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

export interface LengthBar {
  feed_id: string;
  title: string;
  avg: number;
  std: number;
  color: string;
}

export function buildLengthPerFeed(feeds: PerFeed[]): LengthBar[] {
  return feeds
    .map((f) => ({
      feed_id: f.feed_id,
      title: f.title,
      avg: f.avg_length_min,
      std: f.std_length_min,
      color: colorForFeed(f.feed_id),
    }))
    .sort((a, b) => b.avg - a.avg);
}
