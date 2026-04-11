import type { FeedGroup } from "@/lib/search/types";

interface GroupingRow {
  feed_id: string | null;
  feed_title: string;
  feed_mode: string;
  episode_id: string;
  episode_title: string;
  audio_url: string;
  audio_local_path: string | null;
  episode_url: string | null;
  mention_count: number;
  best_rank: string | number;
}

export function groupRowsByFeed(rows: GroupingRow[]): FeedGroup[] {
  const feedMap = new Map<string, FeedGroup>();

  for (const row of rows) {
    const feedKey = row.feed_id ?? "__manual__";
    if (!feedMap.has(feedKey)) {
      feedMap.set(feedKey, {
        // Preserve legacy runtime shape for manual uploads (feed_id NULL from SQL).
        feedId: row.feed_id as unknown as string,
        feedTitle: row.feed_title,
        feedMode: row.feed_mode,
        mentionCount: 0,
        episodes: [],
      });
    }

    const feed = feedMap.get(feedKey)!;
    const mentionCount = row.mention_count;
    feed.mentionCount += mentionCount;
    feed.episodes.push({
      episodeId: row.episode_id,
      episodeTitle: row.episode_title,
      audioUrl: row.audio_url,
      audioLocalPath: row.audio_local_path,
      episodeUrl: row.episode_url,
      mentionCount,
      bestRank: parseFloat(String(row.best_rank)),
    });
  }

  return Array.from(feedMap.values());
}
