import pool from "@/lib/db";

// ── Grouped search types ────────────────────────────────────

export interface GroupedSearchResult {
  feeds: FeedGroup[];
  totalFeeds: number;
  totalEpisodes: number;
  totalMentions: number;
}

export interface FeedGroup {
  feedId: string;
  feedTitle: string;
  mentionCount: number;
  episodes: EpisodeGroup[];
}

export interface EpisodeGroup {
  episodeId: string;
  episodeTitle: string;
  audioUrl: string;
  audioLocalPath: string | null;
  mentionCount: number;
  bestRank: number;
}

export interface EpisodeMentions {
  episodeId: string;
  mentions: Mention[];
}

export interface Mention {
  id: number;
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  snippet: string;
  rank: number;
}

// ── Flat search types ───────────────────────────────────────

export interface SearchResult {
  id: number;
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  snippet: string;
  rank: number;
  episodeId: string;
  episodeTitle: string | null;
  audioUrl: string;
  audioLocalPath: string | null;
  hasDiarization: boolean;
  diarizationError: string | null;
  feedTitle: string | null;
  feedId: string;
}

export interface SearchPage {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Execute full-text search against transcript segments.
 * Per PRD-02 §5.1, §10.
 */
export async function searchSegments(
  query: string,
  feedId: string | null,
  page: number,
  pageSize: number = 20
): Promise<SearchPage> {
  const offset = (page - 1) * pageSize;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT
        s.id,
        s.start_time,
        s.end_time,
        s.speaker_label,
        COALESCE(sn.display_name, s.speaker_label) AS speaker_display,
        ts_headline('english', s.text, query, 'MaxWords=20, MinWords=10') AS snippet,
        ts_rank(to_tsvector('english', s.text), query) AS rank,
        e.id AS episode_id,
        e.title AS episode_title,
        e.audio_url,
        e.audio_local_path,
        e.has_diarization,
        e.diarization_error,
        f.title AS feed_title,
        f.id AS feed_id
      FROM segments s
      JOIN episodes e ON s.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id
      LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = s.speaker_label,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', s.text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)
      ORDER BY rank DESC
      LIMIT $3 OFFSET $4`,
      [query, feedId, pageSize, offset]
    ),
    pool.query(
      `SELECT COUNT(*)
      FROM segments s
      JOIN episodes e ON s.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', s.text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)`,
      [query, feedId]
    ),
  ]);

  const results: SearchResult[] = rowsResult.rows.map((row) => ({
    id: row.id,
    startTime: parseFloat(row.start_time),
    endTime: parseFloat(row.end_time),
    speakerLabel: row.speaker_label,
    speakerDisplay: row.speaker_display,
    snippet: row.snippet,
    rank: parseFloat(row.rank),
    episodeId: row.episode_id,
    episodeTitle: row.episode_title,
    audioUrl: row.audio_url,
    audioLocalPath: row.audio_local_path,
    hasDiarization: row.has_diarization,
    diarizationError: row.diarization_error,
    feedTitle: row.feed_title,
    feedId: row.feed_id,
  }));

  return {
    results,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    pageSize,
  };
}

/**
 * Grouped search — returns results grouped by feed → episode with mention counts.
 * Paginated at the episode level.
 */
export async function searchGrouped(
  query: string,
  feedId: string | null,
  page: number,
  pageSize: number = 20
): Promise<GroupedSearchResult> {
  const offset = (page - 1) * pageSize;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT
        f.id AS feed_id,
        f.title AS feed_title,
        e.id AS episode_id,
        e.title AS episode_title,
        e.audio_url,
        e.audio_local_path,
        COUNT(s.id)::int AS mention_count,
        MAX(ts_rank(to_tsvector('english', s.text), query)) AS best_rank
      FROM segments s
      JOIN episodes e ON s.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', s.text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)
      GROUP BY f.id, f.title, e.id, e.title, e.audio_url, e.audio_local_path
      ORDER BY best_rank DESC, mention_count DESC
      LIMIT $3 OFFSET $4`,
      [query, feedId, pageSize, offset]
    ),
    pool.query(
      `SELECT
        COUNT(DISTINCT e.id)::int AS total_episodes,
        COUNT(DISTINCT f.id)::int AS total_feeds,
        COUNT(s.id)::int AS total_mentions
      FROM segments s
      JOIN episodes e ON s.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', s.text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)`,
      [query, feedId]
    ),
  ]);

  // Group episode rows by feed
  const feedMap = new Map<string, FeedGroup>();

  for (const row of rowsResult.rows) {
    const feedKey = row.feed_id;
    if (!feedMap.has(feedKey)) {
      feedMap.set(feedKey, {
        feedId: row.feed_id,
        feedTitle: row.feed_title,
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
      mentionCount,
      bestRank: parseFloat(row.best_rank),
    });
  }

  const counts = countResult.rows[0];

  return {
    feeds: Array.from(feedMap.values()),
    totalFeeds: counts.total_feeds,
    totalEpisodes: counts.total_episodes,
    totalMentions: counts.total_mentions,
  };
}

/**
 * Fetch individual matching segments for one episode (loaded on expand).
 */
export async function searchMentions(
  query: string,
  episodeId: string
): Promise<EpisodeMentions> {
  const result = await pool.query(
    `SELECT
      s.id,
      s.start_time,
      s.end_time,
      s.speaker_label,
      COALESCE(sn.display_name, s.speaker_label) AS speaker_display,
      ts_headline('english', s.text, query, 'MaxWords=20, MinWords=10') AS snippet,
      ts_rank(to_tsvector('english', s.text), query) AS rank
    FROM segments s
    LEFT JOIN speaker_names sn ON sn.episode_id = s.episode_id AND sn.speaker_label = s.speaker_label,
      plainto_tsquery('english', $1) AS query
    WHERE s.episode_id = $2
      AND to_tsvector('english', s.text) @@ query
    ORDER BY s.start_time ASC`,
    [query, episodeId]
  );

  return {
    episodeId,
    mentions: result.rows.map((row) => ({
      id: row.id,
      startTime: parseFloat(row.start_time),
      endTime: parseFloat(row.end_time),
      speakerLabel: row.speaker_label,
      speakerDisplay: row.speaker_display,
      snippet: row.snippet,
      rank: parseFloat(row.rank),
    })),
  };
}
