import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface TokenPoint {
  episode_id: string; feed_id: string; published_at: string;
  segments: number; chunks: number;
}

export function buildTokensPerEpisode(eps: PerEpisode[]): TokenPoint[] {
  return eps
    .filter((e) => e.published_at)
    .map((e) => ({
      episode_id: e.episode_id, feed_id: e.feed_id,
      published_at: e.published_at!,
      segments: e.token_count_segments,
      chunks: e.token_count_chunks,
    }))
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
}
