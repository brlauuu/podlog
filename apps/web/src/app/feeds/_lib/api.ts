/**
 * Fetch helpers for the /feeds page (split out of page.tsx in #664).
 */
import type { Feed, FeedPreview } from "./types";

export async function fetchFeeds(): Promise<Feed[]> {
  const resp = await fetch("/api/feeds");
  if (!resp.ok) throw new Error("Failed to load feeds");
  return resp.json();
}

export async function fetchPreview(url: string): Promise<FeedPreview> {
  const resp = await fetch(`/api/feeds/preview?url=${encodeURIComponent(url)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load feed preview");
  }
  return resp.json();
}

export async function fetchFeedEpisodeGuids(feedId: string): Promise<string[]> {
  const resp = await fetch(`/api/feeds/${feedId}/episodes/guids`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load existing episodes");
  }
  return resp.json();
}
