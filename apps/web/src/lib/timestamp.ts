import path from "path";

export interface Episode {
  id: string;
  audioUrl: string;
  audioLocalPath: string | null;
  episodeUrl: string | null;
}

/**
 * Build a URL for opening an episode at a specific timestamp.
 *
 * Priority: episode web page > remote audio URL > local fallback.
 * Per issue #14: external playback is primary, local is fallback only.
 */
export function buildTimestampUrl(episode: Episode, startTimeSecs: number): string {
  const t = Math.floor(startTimeSecs);

  // Prefer the episode's web page if available
  if (episode.episodeUrl) {
    return episode.episodeUrl;
  }

  // Remote audio URL with #t= fragment (works in browser <audio>)
  if (episode.audioUrl) {
    return `${episode.audioUrl}#t=${t}`;
  }

  // Local fallback only when no remote URL is available
  if (episode.audioLocalPath) {
    const safeName = path.basename(episode.audioLocalPath);
    return `/api/audio/${episode.id}/${encodeURIComponent(safeName)}#t=${t}`;
  }

  return "#";
}

/**
 * Build a local playback URL for the embedded audio player.
 * Returns null if no local path is available.
 */
export function buildLocalPlaybackUrl(episode: Episode, startTimeSecs: number): string | null {
  if (!episode.audioLocalPath) return null;
  const t = Math.floor(startTimeSecs);
  const safeName = path.basename(episode.audioLocalPath);
  return `/api/audio/${episode.id}/${encodeURIComponent(safeName)}#t=${t}`;
}

/**
 * Format seconds as MM:SS or H:MM:SS for display.
 */
export function formatTimestamp(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
