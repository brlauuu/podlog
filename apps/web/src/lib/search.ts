import pool from "@/lib/db";
import { PIPELINE_API } from "@/lib/pipeline";
import { buildFeedFilter } from "@/lib/search/feedFilter";
import { groupRowsByFeed } from "@/lib/search/grouping";
import { SPEAKER_TURNS_CTE } from "@/lib/search/speakerTurns";
import { mergeHybridSearchResults } from "@/lib/searchHybrid";
import type {
  ContextSegment,
  EpisodeCoverage,
  EpisodeMentions,
  GroupedSearchResult,
  Mention,
  SearchPage,
} from "@/lib/search/types";

export type {
  ContextSegment,
  EpisodeCoverage,
  EpisodeMentions,
  FeedGroup,
  GroupedSearchResult,
  Mention,
  SearchPage,
  SearchResult,
} from "@/lib/search/types";

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
  feedIds: string[] | null,
  includeManualUploads: boolean,
  page: number,
  pageSize: number = 20,
  skipCount: boolean = false,
  speakerLabel: string | null = null
): Promise<SearchPage> {
  const FETCH_LIMIT = 100; // fetch more than pageSize for RRF merging
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);

  // FTS query — speaker filter uses table alias 't'
  const ftsSpeakerClause = speakerLabel ? `AND t.speaker_label = $${feedFilter.nextIdx}` : "";
  const ftsLimitIdx = feedFilter.nextIdx + (speakerLabel ? 1 : 0);
  const ftsParams = [query, ...feedFilter.params, ...(speakerLabel ? [speakerLabel] : []), FETCH_LIMIT];

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
      AND ${feedFilter.clause}
      ${ftsSpeakerClause}
    ORDER BY rank DESC
    LIMIT $${ftsLimitIdx}`,
    ftsParams
  );

  const embedding = await getQueryEmbedding(query);
  const vecFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  // Vector query — speaker filter uses table alias 's'
  const vecSpeakerClause = speakerLabel ? `AND s.speaker_label = $${vecFeedFilter.nextIdx}` : "";
  const vecLimitIdx = vecFeedFilter.nextIdx + (speakerLabel ? 1 : 0);
  const vecParams = [`[${embedding?.join(",")}]`, ...vecFeedFilter.params, ...(speakerLabel ? [speakerLabel] : []), FETCH_LIMIT];

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
          AND ${vecFeedFilter.clause}
          ${vecSpeakerClause}
        ORDER BY s.embedding <=> $1::vector
        LIMIT $${vecLimitIdx}`,
        vecParams
      )
    : Promise.resolve({ rows: [] });

  const countFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countSpeakerClause = speakerLabel ? `AND t.speaker_label = $${countFeedFilter.nextIdx}` : "";
  const countParams = [query, ...countFeedFilter.params, ...(speakerLabel ? [speakerLabel] : [])];
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
          AND ${countFeedFilter.clause}
          ${countSpeakerClause}`,
        countParams
      );

  const coveragePromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
          COUNT(*)::int AS total
        FROM episodes`
      );

  const [ftsResult, vecResult, countResult, coverageResult] = await Promise.all([
    ftsPromise,
    vecPromise,
    countPromise,
    coveragePromise,
  ]);

  const ftsTotal = countResult ? parseInt(countResult.rows[0].count, 10) : -1;
  const merged = mergeHybridSearchResults({
    ftsRows: ftsResult.rows,
    vecRows: vecResult.rows,
    page,
    pageSize,
    ftsTotal,
  });

  const cov = coverageResult?.rows[0];
  const coverage: EpisodeCoverage = {
    processed: cov?.processed ?? 0,
    total: cov?.total ?? 0,
  };

  return { results: merged.results, total: merged.total, page, pageSize, coverage };
}

/**
 * Grouped search — returns results grouped by feed -> episode with mention counts.
 * Counts are based on deduplicated speaker turns, not raw segments.
 */
export async function searchGrouped(
  query: string,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  page: number,
  pageSize: number = 20,
  skipCount: boolean = false,
  speakerLabel: string | null = null
): Promise<GroupedSearchResult> {
  const offset = (page - 1) * pageSize;
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const rowsSpeakerClause = speakerLabel ? `AND t.speaker_label = $${feedFilter.nextIdx}` : "";
  const rowsLimitIdx = feedFilter.nextIdx + (speakerLabel ? 1 : 0);
  const rowsParams = [query, ...feedFilter.params, ...(speakerLabel ? [speakerLabel] : []), pageSize, offset];

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
      AND ${feedFilter.clause}
      ${rowsSpeakerClause}
    GROUP BY f.id, f.title, f.mode, e.id, e.title, e.audio_url, e.audio_local_path, e.episode_url
    ORDER BY best_rank DESC, mention_count DESC
    LIMIT $${rowsLimitIdx} OFFSET $${rowsLimitIdx + 1}`,
    rowsParams
  );

  const grpCountFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countSpeakerClause = speakerLabel ? `AND t.speaker_label = $${grpCountFilter.nextIdx}` : "";
  const countParams = [query, ...grpCountFilter.params, ...(speakerLabel ? [speakerLabel] : [])];
  const countPromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `WITH ${SPEAKER_TURNS_CTE}
        SELECT
          COUNT(DISTINCT e.id)::int AS total_episodes,
          COUNT(DISTINCT f.id)::int AS total_feeds,
          COUNT(*)::int AS total_mentions,
          BOOL_OR(e.feed_id IS NULL)::bool AS has_manual
        FROM speaker_turns t
        JOIN episodes e ON t.episode_id = e.id
        LEFT JOIN feeds f ON e.feed_id = f.id,
          websearch_to_tsquery('english', $1) AS query
        WHERE to_tsvector('english', t.full_text) @@ query
          AND e.status = 'done'
          AND ${grpCountFilter.clause}
          ${countSpeakerClause}`,
        countParams
      );

  const coveragePromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
          COUNT(*)::int AS total
        FROM episodes`
      );

  const [rowsResult, countResult, coverageResult] = await Promise.all([
    rowsPromise,
    countPromise,
    coveragePromise,
  ]);

  const counts = countResult?.rows[0];
  const cov = coverageResult?.rows[0];

  return {
    feeds: groupRowsByFeed(rowsResult.rows),
    totalFeeds: (counts?.total_feeds ?? -1) + (counts?.has_manual ? 1 : 0),
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

    const before: ContextSegment[] = [];
    for (let i = idx - 1; i >= 0 && before.length < CONTEXT_SIZE; i--) {
      if (!allTurns[i].is_match) before.unshift(toContextSegment(allTurns[i]));
      else break;
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
