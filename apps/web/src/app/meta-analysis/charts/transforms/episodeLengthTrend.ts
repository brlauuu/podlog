import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface TrendPoint { ts: number; duration_min: number; }

export function buildEpisodeLengthTrend(
  eps: PerEpisode[]
): Record<string, TrendPoint[]> {
  const out: Record<string, TrendPoint[]> = {};
  for (const ep of eps) {
    if (!ep.published_at) continue;
    const list = out[ep.feed_id] ?? (out[ep.feed_id] = []);
    list.push({
      ts: new Date(ep.published_at).getTime(),
      duration_min: (ep.duration_secs ?? 0) / 60,
    });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.ts - b.ts);
  return out;
}
