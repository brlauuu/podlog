/**
 * Types and small formatting helpers for the /feeds page (split out of
 * page.tsx in #664).
 */
export interface Feed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
  paused: boolean;
  last_polled_at: string | null;
  episode_count: number;
}

// Issue #84: episode preview shape returned by GET /api/feeds/preview
export interface EpisodePreview {
  guid: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
  audio_url: string;
}

export interface FeedPreview {
  title: string | null;
  episodes: EpisodePreview[];
}

export function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
