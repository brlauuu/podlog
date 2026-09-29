/**
 * Fetch helpers for the /feeds page (split out of page.tsx in #664).
 */
import type { Feed, FeedPreview } from "./types";

export async function fetchFeeds(): Promise<Feed[]> {
  const resp = await fetch("/api/feeds");
  if (!resp.ok) throw new Error("Failed to load feeds");
  return resp.json();
}

// `signal` lets the page abandon a load the user closed the dialog on (#1066).
export async function fetchPreview(url: string, signal?: AbortSignal): Promise<FeedPreview> {
  const target = `/api/feeds/preview?url=${encodeURIComponent(url)}`;
  const resp = signal ? await fetch(target, { signal }) : await fetch(target);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load feed preview");
  }
  return resp.json();
}

export async function fetchFeedEpisodeGuids(
  feedId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const target = `/api/feeds/${feedId}/episodes/guids`;
  const resp = signal ? await fetch(target, { signal }) : await fetch(target);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load existing episodes");
  }
  return resp.json();
}
