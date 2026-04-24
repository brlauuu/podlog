import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

export interface ShareRow {
  feed_id: string; title: string; host_pct: number; guest_pct: number;
}

export function buildHostGuestShare(
  eps: PerEpisode[], feeds: PerFeed[]
): ShareRow[] {
  const byFeed: Record<string, number[]> = {};
  for (const ep of eps) {
    if (ep.host_share == null) continue;
    (byFeed[ep.feed_id] ??= []).push(ep.host_share);
  }
  return feeds
    .filter((f) => byFeed[f.feed_id]?.length)
    .map((f) => {
      const arr = byFeed[f.feed_id];
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return {
        feed_id: f.feed_id,
        title: f.title,
        host_pct: Math.round(avg * 100),
        guest_pct: Math.round((1 - avg) * 100),
      };
    });
}
