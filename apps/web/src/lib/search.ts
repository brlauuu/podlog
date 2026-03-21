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
  feedMode: string;
  mentionCount: number;
  episodes: EpisodeGroup[];
}

export interface EpisodeGroup {
  episodeId: string;
  episodeTitle: string;
  audioUrl: string;
  audioLocalPath: string | null;
  episodeUrl: string | null;
  mentionCount: number;
  bestRank: number;
}

export interface EpisodeMentions {
  episodeId: string;
  mentions: Mention[];
}

export interface ContextSegment {
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  text: string;
}

export interface Mention {
  id: number;
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  snippet: string;
  text: string;
  rank: number;
  contextBefore: ContextSegment[];
  contextAfter: ContextSegment[];
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
  episodeUrl: string | null;
  hasDiarization: boolean;
  diarizationError: string | null;
  feedTitle: string | null;
  feedMode: string;
  feedId: string;
}

export interface SearchPage {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Speaker turn aggregation CTE ────────────────────────────
//
// Assigns a turn number to each segment based on consecutive same-speaker
// runs within an episode. Used by all search functions to deduplicate
// results: one hit per speaker turn instead of one per segment.

const SPEAKER_TURNS_CTE = `
  lagged AS (
    SELECT s.id, s.episode_id, s.speaker_label, s.start_time, s.end_time, s.text,
      CASE WHEN s.speaker_label IS DISTINCT FROM
        LAG(s.speaker_label) OVER (PARTITION BY s.episode_id ORDER BY s.start_time)
        THEN 1 ELSE 0 END AS is_new_turn
    FROM segments s
  ),
  turn_numbered AS (
    SELECT l.*,
      SUM(is_new_turn) OVER (PARTITION BY episode_id ORDER BY start_time) AS turn_num
    FROM lagged l
  ),
  speaker_turns AS (
    SELECT
      episode_id,
      speaker_label,
      turn_num,
      MIN(id) AS min_id,
      MIN(start_time) AS start_time,
      MAX(end_time) AS end_time,
      string_agg(text, ' ' ORDER BY start_time) AS full_text
    FROM turn_numbered
    GROUP BY episode_id, speaker_label, turn_num
  )`;

/**
 * Execute full-text search against transcript segments, aggregated by speaker turn.
 * Per PRD-02 §5.1, §10. Deduplicates results so each speaker turn appears once.
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
      `WITH ${SPEAKER_TURNS_CTE}
      SELECT
        t.min_id AS id,
        t.start_time,
        t.end_time,
        t.speaker_label,
        COALESCE(sn.display_name, t.speaker_label) AS speaker_display,
        ts_headline('english', t.full_text, query, 'MaxWords=25, MinWords=12') AS snippet,
        ts_rank(to_tsvector('english', t.full_text), query) AS rank,
        e.id AS episode_id,
        e.title AS episode_title,
        e.audio_url,
        e.audio_local_path,
        e.episode_url,
        e.has_diarization,
        e.diarization_error,
        f.title AS feed_title,
        f.mode AS feed_mode,
        f.id AS feed_id
      FROM speaker_turns t
      JOIN episodes e ON t.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id
      LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = t.speaker_label,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', t.full_text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)
      ORDER BY rank DESC
      LIMIT $3 OFFSET $4`,
      [query, feedId, pageSize, offset]
    ),
    pool.query(
      `WITH ${SPEAKER_TURNS_CTE}
      SELECT COUNT(*)
      FROM speaker_turns t
      JOIN episodes e ON t.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', t.full_text) @@ query
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
    episodeUrl: row.episode_url,
    hasDiarization: row.has_diarization,
    diarizationError: row.diarization_error,
    feedTitle: row.feed_title,
    feedMode: row.feed_mode,
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
 * Counts are based on deduplicated speaker turns, not raw segments.
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
      `WITH ${SPEAKER_TURNS_CTE}
      SELECT
        f.id AS feed_id,
        f.title AS feed_title,
        f.mode AS feed_mode,
        e.id AS episode_id,
        e.title AS episode_title,
        e.audio_url,
        e.audio_local_path,
        e.episode_url,
        COUNT(*)::int AS mention_count,
        MAX(ts_rank(to_tsvector('english', t.full_text), query)) AS best_rank
      FROM speaker_turns t
      JOIN episodes e ON t.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', t.full_text) @@ query
        AND ($2::uuid IS NULL OR f.id = $2)
      GROUP BY f.id, f.title, f.mode, e.id, e.title, e.audio_url, e.audio_local_path, e.episode_url
      ORDER BY best_rank DESC, mention_count DESC
      LIMIT $3 OFFSET $4`,
      [query, feedId, pageSize, offset]
    ),
    pool.query(
      `WITH ${SPEAKER_TURNS_CTE}
      SELECT
        COUNT(DISTINCT e.id)::int AS total_episodes,
        COUNT(DISTINCT f.id)::int AS total_feeds,
        COUNT(*)::int AS total_mentions
      FROM speaker_turns t
      JOIN episodes e ON t.episode_id = e.id
      JOIN feeds f ON e.feed_id = f.id,
        plainto_tsquery('english', $1) AS query
      WHERE to_tsvector('english', t.full_text) @@ query
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
 * Fetch matching speaker turns for one episode with surrounding context.
 * Returns 1-2 turns before and after each match for dialogue context.
 */
export async function searchMentions(
  query: string,
  episodeId: string
): Promise<EpisodeMentions> {
  // Fetch all speaker turns for this episode with match info in one query
  const result = await pool.query(
    `WITH ${SPEAKER_TURNS_CTE}
    SELECT
      t.min_id AS id,
      t.start_time,
      t.end_time,
      t.speaker_label,
      COALESCE(sn.display_name, t.speaker_label) AS speaker_display,
      t.full_text,
      CASE WHEN to_tsvector('english', t.full_text) @@ query THEN true ELSE false END AS is_match,
      CASE WHEN to_tsvector('english', t.full_text) @@ query
        THEN ts_headline('english', t.full_text, query, 'MaxWords=25, MinWords=12')
        ELSE '' END AS snippet,
      CASE WHEN to_tsvector('english', t.full_text) @@ query
        THEN ts_rank(to_tsvector('english', t.full_text), query)
        ELSE 0 END AS rank
    FROM speaker_turns t
    LEFT JOIN speaker_names sn ON sn.episode_id = t.episode_id AND sn.speaker_label = t.speaker_label,
      plainto_tsquery('english', $1) AS query
    WHERE t.episode_id = $2
    ORDER BY t.start_time ASC`,
    [query, episodeId]
  );

  const allTurns = result.rows;
  const matchIndices = allTurns
    .map((row, i) => (row.is_match ? i : -1))
    .filter((i) => i >= 0);

  const CONTEXT_SIZE = 2;

  function toContextSegment(row: typeof allTurns[0]): ContextSegment {
    return {
      startTime: parseFloat(row.start_time),
      endTime: parseFloat(row.end_time),
      speakerLabel: row.speaker_label,
      speakerDisplay: row.speaker_display,
      text: row.full_text,
    };
  }

  const mentions: Mention[] = matchIndices.map((idx) => {
    const row = allTurns[idx];

    // Gather context turns, skipping other matches
    const before: ContextSegment[] = [];
    for (let i = idx - 1; i >= 0 && before.length < CONTEXT_SIZE; i--) {
      if (!allTurns[i].is_match) before.unshift(toContextSegment(allTurns[i]));
      else break; // stop at adjacent match to avoid overlap
    }

    const after: ContextSegment[] = [];
    for (let i = idx + 1; i < allTurns.length && after.length < CONTEXT_SIZE; i++) {
      if (!allTurns[i].is_match) after.push(toContextSegment(allTurns[i]));
      else break;
    }

    return {
      id: row.id,
      startTime: parseFloat(row.start_time),
      endTime: parseFloat(row.end_time),
      speakerLabel: row.speaker_label,
      speakerDisplay: row.speaker_display,
      snippet: row.snippet,
      text: row.full_text,
      rank: parseFloat(row.rank),
      contextBefore: before,
      contextAfter: after,
    };
  });

  return { episodeId, mentions };
}
