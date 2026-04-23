import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface DensityPoint {
  duration_min: number;
  turns_per_min: number;
  feed_id: string;
  episode_id: string;
}

export function buildTurnDensity(eps: PerEpisode[]): DensityPoint[] {
  return eps
    .filter((e) => (e.duration_secs ?? 0) > 0)
    .map((e) => ({
      duration_min: (e.duration_secs ?? 0) / 60,
      turns_per_min: (e.turn_count ?? 0) / ((e.duration_secs ?? 0) / 60),
      feed_id: e.feed_id,
      episode_id: e.episode_id,
    }));
}
