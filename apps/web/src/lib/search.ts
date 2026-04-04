import pool from "@/lib/db";

const PIPELINE_API = process.env.PIPELINE_API ?? "http://pipeline:8000";

/**
 * Get embedding for a search query from the pipeline's embed API.
 * Returns null if embedding service is unavailable (graceful degradation to FTS-only).
 */
async function getQueryEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.embedding;
  } catch {
    return null;
  }
}

// ── Grouped search types ────────────────────────────────────

export interface GroupedSearchResult {
  feeds: FeedGroup[];
  totalFeeds: number;
  totalEpisodes: number;
  totalMentions: number;
  coverage: EpisodeCoverage;
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

export interface EpisodeCoverage {
  processed: number;
  total: number;
}

export interface SearchPage {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  coverage: EpisodeCoverage;
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

// RRF constant — standard value for Reciprocal Rank Fusion
const RRF_K = 60;

/**
 * Truncate text to ~200 chars for vector-only result snippets.
 */
function truncateSnippet(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s\S*$/, "") + "…";
}

/**
 * Hybrid search: FTS + vector similarity with Reciprocal Rank Fusion.
 *
 * Runs keyword search (websearch_to_tsquery on speaker turns) and semantic
 * search (pgvector cosine similarity on segments) in parallel. Results are
 * merged using RRF so keyword-exact matches rank high while semantically
 * similar content is also surfaced. Falls back to FTS-only if embeddings
 * are unavailable.
 */
export async function searchSegments(
  query: string,
  feedId: string | null,
  page: number,
  pageSize: number = 20,
  skipCount: boolean = false
): Promise<SearchPage> {
  const FETCH_LIMIT = 100; // fetch more than pageSize for RRF merging

  // 1. FTS on speaker turns
  const ftsPromise = pool.query(
    `WITH ${SPEAKER_TURNS_CTE}
    SELECT
      t.min_id AS id,
      t.start_time,
      t.end_time,
      t.speaker_label,
      COALESCE(sn.display_name, t.speaker_label) AS speaker_display,
      ts_headline('english', t.full_text, query, 'MaxFragments=0, HighlightAll=true') AS snippet,
      ts_rank(to_tsvector('english', t.full_text), query) AS rank,
      e.id AS episode_id,
      e.title AS episode_title,
      e.audio_url,
      e.audio_local_path,
      e.episode_url,
      e.has_diarization,
      e.diarization_error,
      COALESCE(f.title, 'Manual episode') AS feed_title,
      COALESCE(f.mode, 'full') AS feed_mode,
      f.id AS feed_id
    FROM speaker_turns t
    JOIN episodes e ON t.episode_id = e.id
    LEFT JOIN feeds f ON e.feed_id = f.id
    LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = t.speaker_label,
      websearch_to_tsquery('english', $1) AS query
    WHERE to_tsvector('english', t.full_text) @@ query
      AND e.status = 'done'
      AND ($2::uuid IS NULL OR f.id = $2)
    ORDER BY rank DESC
    LIMIT $3`,
    [query, feedId, FETCH_LIMIT]
  );

  // 2. Vector similarity on raw segments (if embeddings available)
  const embedding = await getQueryEmbedding(query);
  const vecPromise = embedding
    ? pool.query(
        `SELECT
          s.id,
          s.start_time,
          s.end_time,
          s.speaker_label,
          COALESCE(sn.display_name, s.speaker_label) AS speaker_display,
          s.text,
          1 - (s.embedding <=> $1::vector) AS similarity,
          e.id AS episode_id,
          e.title AS episode_title,
          e.audio_url,
          e.audio_local_path,
          e.episode_url,
          e.has_diarization,
          e.diarization_error,
          COALESCE(f.title, 'Manual episode') AS feed_title,
          COALESCE(f.mode, 'full') AS feed_mode,
          f.id AS feed_id
        FROM segments s
        JOIN episodes e ON s.episode_id = e.id
        LEFT JOIN feeds f ON e.feed_id = f.id
        LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = s.speaker_label
        WHERE s.embedding IS NOT NULL
          AND e.status = 'done'
          AND ($2::uuid IS NULL OR f.id = $2)
        ORDER BY s.embedding <=> $1::vector
        LIMIT $3`,
        [`[${embedding.join(",")}]`, feedId, FETCH_LIMIT]
      )
    : Promise.resolve({ rows: [] });

  // 3. Count (FTS-based, skipped on page 2+)
  const countPromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `WITH ${SPEAKER_TURNS_CTE}
        SELECT COUNT(*)
        FROM speaker_turns t
        JOIN episodes e ON t.episode_id = e.id
        LEFT JOIN feeds f ON e.feed_id = f.id,
          websearch_to_tsquery('english', $1) AS query
        WHERE to_tsvector('english', t.full_text) @@ query
          AND e.status = 'done'
          AND ($2::uuid IS NULL OR f.id = $2)`,
        [query, feedId]
      );

  // 4. Episode coverage (processed vs total)
  const coveragePromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
          COUNT(*)::int AS total
        FROM episodes`
      );

  const [ftsResult, vecResult, countResult, coverageResult] = await Promise.all([
    ftsPromise, vecPromise, countPromise, coveragePromise,
  ]);

  // 4. Build result map keyed by episodeId:bucketedTime for deduplication
  type MergedEntry = SearchResult & { ftsRank?: number; vecRank?: number; rrfScore: number };
  const merged = new Map<string, MergedEntry>();

  function bucketKey(episodeId: string, startTime: number): string {
    return `${episodeId}:${Math.floor(startTime / 30)}`; // 30-second buckets
  }

  // Add FTS results
  ftsResult.rows.forEach((row, i) => {
    const key = bucketKey(row.episode_id, parseFloat(row.start_time));
    merged.set(key, {
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
      ftsRank: i + 1,
      rrfScore: 1 / (RRF_K + i + 1),
    });
  });

  // Add/merge vector results
  vecResult.rows.forEach((row, i) => {
    const key = bucketKey(row.episode_id, parseFloat(row.start_time));
    const vecScore = 1 / (RRF_K + i + 1);
    const existing = merged.get(key);
    if (existing) {
      // Boost existing FTS result with vector score
      existing.vecRank = i + 1;
      existing.rrfScore += vecScore;
    } else {
      // Vector-only result (semantic match, no keyword match)
      merged.set(key, {
        id: row.id,
        startTime: parseFloat(row.start_time),
        endTime: parseFloat(row.end_time),
        speakerLabel: row.speaker_label,
        speakerDisplay: row.speaker_display,
        snippet: truncateSnippet(row.text),
        rank: parseFloat(row.similarity),
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
        vecRank: i + 1,
        rrfScore: vecScore,
      });
    }
  });

  // 5. Sort by RRF score, paginate
  const sorted = Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  const offset = (page - 1) * pageSize;
  const results: SearchResult[] = sorted.slice(offset, offset + pageSize);

  // Total: use FTS count (vector-only results are supplementary)
  const ftsTotal = countResult ? parseInt(countResult.rows[0].count, 10) : -1;
  const total = ftsTotal >= 0 ? Math.max(ftsTotal, sorted.length) : -1;

  const cov = coverageResult?.rows[0];
  const coverage: EpisodeCoverage = {
    processed: cov?.processed ?? 0,
    total: cov?.total ?? 0,
  };

  return { results, total, page, pageSize, coverage };
}

/**
 * Grouped search — returns results grouped by feed → episode with mention counts.
 * Counts are based on deduplicated speaker turns, not raw segments.
 */
export async function searchGrouped(
  query: string,
  feedId: string | null,
  page: number,
  pageSize: number = 20,
  skipCount: boolean = false
): Promise<GroupedSearchResult> {
  const offset = (page - 1) * pageSize;

  const rowsPromise = pool.query(
    `WITH ${SPEAKER_TURNS_CTE}
    SELECT
      f.id AS feed_id,
      COALESCE(f.title, 'Manual episode') AS feed_title,
      COALESCE(f.mode, 'full') AS feed_mode,
      e.id AS episode_id,
      e.title AS episode_title,
      e.audio_url,
      e.audio_local_path,
      e.episode_url,
      COUNT(*)::int AS mention_count,
      MAX(ts_rank(to_tsvector('english', t.full_text), query)) AS best_rank
    FROM speaker_turns t
    JOIN episodes e ON t.episode_id = e.id
    LEFT JOIN feeds f ON e.feed_id = f.id,
      websearch_to_tsquery('english', $1) AS query
    WHERE to_tsvector('english', t.full_text) @@ query
      AND e.status = 'done'
      AND ($2::uuid IS NULL OR f.id = $2)
    GROUP BY f.id, f.title, f.mode, e.id, e.title, e.audio_url, e.audio_local_path, e.episode_url
    ORDER BY best_rank DESC, mention_count DESC
    LIMIT $3 OFFSET $4`,
    [query, feedId, pageSize, offset]
  );

  const countPromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `WITH ${SPEAKER_TURNS_CTE}
        SELECT
          COUNT(DISTINCT e.id)::int AS total_episodes,
          COUNT(DISTINCT f.id)::int AS total_feeds,
          COUNT(*)::int AS total_mentions
        FROM speaker_turns t
        JOIN episodes e ON t.episode_id = e.id
        LEFT JOIN feeds f ON e.feed_id = f.id,
          websearch_to_tsquery('english', $1) AS query
        WHERE to_tsvector('english', t.full_text) @@ query
          AND e.status = 'done'
          AND ($2::uuid IS NULL OR f.id = $2)`,
        [query, feedId]
      );

  const coveragePromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
          COUNT(*)::int AS total
        FROM episodes`
      );

  const [rowsResult, countResult, coverageResult] = await Promise.all([rowsPromise, countPromise, coveragePromise]);

  // Group episode rows by feed
  const feedMap = new Map<string, FeedGroup>();

  for (const row of rowsResult.rows) {
    const feedKey = row.feed_id ?? "__manual__";
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

  const counts = countResult?.rows[0];
  const cov = coverageResult?.rows[0];

  return {
    feeds: Array.from(feedMap.values()),
    totalFeeds: counts?.total_feeds ?? -1,
    totalEpisodes: counts?.total_episodes ?? -1,
    totalMentions: counts?.total_mentions ?? -1,
    coverage: {
      processed: cov?.processed ?? 0,
      total: cov?.total ?? 0,
    },
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
        THEN ts_headline('english', t.full_text, query, 'MaxFragments=0, HighlightAll=true')
        ELSE '' END AS snippet,
      CASE WHEN to_tsvector('english', t.full_text) @@ query
        THEN ts_rank(to_tsvector('english', t.full_text), query)
        ELSE 0 END AS rank
    FROM speaker_turns t
    LEFT JOIN speaker_names sn ON sn.episode_id = t.episode_id AND sn.speaker_label = t.speaker_label,
      websearch_to_tsquery('english', $1) AS query
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
