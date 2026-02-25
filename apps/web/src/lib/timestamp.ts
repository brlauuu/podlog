import path from "path";

export interface Episode {
  id: string;
  audioUrl: string;
  audioLocalPath: string | null;
}

/**
 * Build a URL for playing an episode at a specific timestamp.
 *
 * If the episode has a local archived file, returns a path to the
 * path-validated local serving API route.
 * Otherwise, returns the remote URL with an #t= fragment.
 *
 * Per PRD-02 §5.2, §11.
 */
export function buildTimestampUrl(episode: Episode, startTimeSecs: number): string {
  const t = Math.floor(startTimeSecs);

  if (episode.audioLocalPath) {
    // Use basename only — path traversal prevention is enforced in the route handler
    const safeName = path.basename(episode.audioLocalPath);
    return `/api/audio/${episode.id}/${encodeURIComponent(safeName)}#t=${t}`;
  }

  return `${episode.audioUrl}#t=${t}`;
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
