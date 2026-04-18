import pool from "@/lib/db";
import { buildFeedFilter } from "@/lib/search/feedFilter";
import {
  appendFilterSql,
  buildLikePattern,
  buildMetadataFilters,
  buildSegmentFilters,
  buildSpeakerTurnFilters,
} from "@/lib/search/filters";
import { buildCoverage, toCoverage } from "@/lib/search/coverage";
import { getQueryEmbedding } from "@/lib/search/embedding";
import { buildMetadataSnippet, type FilterOpts } from "@/lib/search/filterOpts";
import { parseSearchQuery } from "@/lib/search/queryParser";
import { SPEAKER_TURNS_CTE } from "@/lib/search/speakerTurns";
import { mergeHybridSearchResults } from "@/lib/searchHybrid";
import type { SearchPage, SearchResult } from "@/lib/search/types";

/**
 * Hybrid search: FTS + vector similarity with Reciprocal Rank Fusion.
 * Falls back to FTS-only if embeddings are unavailable.
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
  const parsed = parseSearchQuery(query);
  const speakerLike = buildLikePattern(parsed.speakerFilter);
  const filterOpts: FilterOpts = {
    speakerLabel,
    speakerLike,
    titleFilter: parsed.titleFilter,
    descriptionFilter: parsed.descriptionFilter,
  };

  if (parsed.mode === "metadata_only") {
    return searchSegmentsMetadata(filterOpts, feedIds, includeManualUploads, page, pageSize, skipCount, parsed);
  }

  const baseQuery = parsed.freeText || query.trim();
  return searchSegmentsHybrid(baseQuery, filterOpts, feedIds, includeManualUploads, page, pageSize, skipCount);
}

async function searchSegmentsMetadata(
  filterOpts: FilterOpts,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  page: number,
  pageSize: number,
  skipCount: boolean,
  parsed: ReturnType<typeof parseSearchQuery>,
): Promise<SearchPage> {
  const offset = (page - 1) * pageSize;
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 1);
  const metaFilters = buildMetadataFilters(filterOpts, feedFilter.nextIdx);

  const whereClauses = ["e.status = 'done'", feedFilter.clause, ...metaFilters.clauses];
  const params = [...feedFilter.params, ...metaFilters.params];
  const idx = metaFilters.nextIdx;
  const whereSql = whereClauses.join("\n      AND ");

  const rowsPromise = pool.query(
    `SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(e.published_at, e.created_at) DESC, e.id DESC)::int AS id,
      0::double precision AS start_time,
      0::double precision AS end_time,
      NULL::text AS speaker_label,
      NULL::text AS speaker_display,
      e.id AS episode_id,
      e.title AS episode_title,
      e.description AS episode_description,
      e.audio_url,
      e.audio_local_path,
      e.episode_url,
      e.has_diarization,
      e.diarization_error,
      COALESCE(f.title, 'Manual episode') AS feed_title,
      COALESCE(f.mode, 'full') AS feed_mode,
      f.id AS feed_id
    FROM episodes e
    LEFT JOIN feeds f ON e.feed_id = f.id
    WHERE ${whereSql}
    ORDER BY COALESCE(e.published_at, e.created_at) DESC, e.id DESC
    LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  const countPromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `SELECT COUNT(*)::int AS total
        FROM episodes e
        LEFT JOIN feeds f ON e.feed_id = f.id
        WHERE ${whereSql}`,
        params
      );

  const [rowsResult, countResult, coverageResult] = await Promise.all([
    rowsPromise,
    countPromise,
    buildCoverage(skipCount),
  ]);

  const results: SearchResult[] = rowsResult.rows.map((row) => ({
    id: row.id,
    startTime: 0,
    endTime: 0,
    speakerLabel: null,
    speakerDisplay: null,
    snippet: buildMetadataSnippet(row, parsed),
    rank: 1,
    episodeId: row.episode_id,
    episodeTitle: row.episode_title,
    audioUrl: row.audio_url,
    audioLocalPath: row.audio_local_path,
    episodeUrl: row.episode_url,
    hasDiarization: row.has_diarization,
    diarizationError: row.diarization_error,
    feedTitle: row.feed_title,
    feedMode: row.feed_mode,
    feedId: row.feed_id ?? "__manual__",
  }));

  const total = countResult ? parseInt(String(countResult.rows[0].total), 10) : -1;
  return { results, total, page, pageSize, coverage: toCoverage(coverageResult) };
}

async function searchSegmentsHybrid(
  baseQuery: string,
  filterOpts: FilterOpts,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  page: number,
  pageSize: number,
  skipCount: boolean,
): Promise<SearchPage> {
  const FETCH_LIMIT = 100;

  // FTS query
  const ftsFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const ftsFilters = buildSpeakerTurnFilters(filterOpts, ftsFeedFilter.nextIdx);
  const ftsParams = [baseQuery, ...ftsFeedFilter.params, ...ftsFilters.params];

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
      AND ${ftsFeedFilter.clause}
      ${appendFilterSql(ftsFilters.clauses)}
    ORDER BY rank DESC
    LIMIT $${ftsFilters.nextIdx}`,
    [...ftsParams, FETCH_LIMIT]
  );

  // Vector query
  const embedding = await getQueryEmbedding(baseQuery);
  const vecFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const vecFilters = buildSegmentFilters(filterOpts, vecFeedFilter.nextIdx);
  const vecParams = [`[${embedding?.join(",")}]`, ...vecFeedFilter.params, ...vecFilters.params];

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
          ${appendFilterSql(vecFilters.clauses)}
        ORDER BY s.embedding <=> $1::vector
        LIMIT $${vecFilters.nextIdx}`,
        [...vecParams, FETCH_LIMIT]
      )
    : Promise.resolve({ rows: [] });

  // Count query
  const countFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countFilters = buildSpeakerTurnFilters(filterOpts, countFeedFilter.nextIdx);
  const countParams = [baseQuery, ...countFeedFilter.params, ...countFilters.params];

  const countPromise = skipCount
    ? Promise.resolve(null)
    : pool.query(
        `WITH ${SPEAKER_TURNS_CTE}
        SELECT COUNT(*)
        FROM speaker_turns t
        JOIN episodes e ON t.episode_id = e.id
        LEFT JOIN feeds f ON e.feed_id = f.id
        LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = t.speaker_label,
          websearch_to_tsquery('english', $1) AS query
        WHERE to_tsvector('english', t.full_text) @@ query
          AND e.status = 'done'
          AND ${countFeedFilter.clause}
          ${appendFilterSql(countFilters.clauses)}`,
        countParams
      );

  const [ftsResult, vecResult, countResult, coverageResult] = await Promise.all([
    ftsPromise,
    vecPromise,
    countPromise,
    buildCoverage(skipCount),
  ]);

  const ftsTotal = countResult ? parseInt(countResult.rows[0].count, 10) : -1;
  const merged = mergeHybridSearchResults({
    ftsRows: ftsResult.rows,
    vecRows: vecResult.rows,
    page,
    pageSize,
    ftsTotal,
  });

  return { results: merged.results, total: merged.total, page, pageSize, coverage: toCoverage(coverageResult) };
}
