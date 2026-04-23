import type { PerFeed, TimelineMonthly } from "@/lib/metaAnalysisTypes";

export interface TimelineRow { month: string; [feedId: string]: number | string; }

export function buildReleaseTimeline(
  tl: TimelineMonthly[], feeds: PerFeed[]
): TimelineRow[] {
  const months = Array.from(new Set(tl.map((r) => r.month))).sort();
  const feedIds = feeds.map((f) => f.feed_id);
  return months.map((m) => {
    const row: TimelineRow = { month: m };
    for (const fid of feedIds) {
      const hit = tl.find((r) => r.month === m && r.feed_id === fid);
      row[fid] = hit ? hit.episode_count : 0;
    }
    return row;
  });
}
