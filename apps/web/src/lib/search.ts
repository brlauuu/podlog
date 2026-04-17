import pool from "@/lib/db";
import { PIPELINE_API } from "@/lib/pipeline";
import { buildFeedFilter } from "@/lib/search/feedFilter";
import {
  appendFilterSql,
  buildLikePattern,
  buildMetadataFilters,
  buildSegmentFilters,
  buildSpeakerTurnFilters,
} from "@/lib/search/filters";
import { groupRowsByFeed } from "@/lib/search/grouping";
import { parseSearchQuery } from "@/lib/search/queryParser";
import { SPEAKER_TURNS_CTE } from "@/lib/search/speakerTurns";
import { mergeHybridSearchResults } from "@/lib/searchHybrid";
import type {
  ContextSegment,
  EpisodeCoverage,
  EpisodeMentions,
  GroupedSearchResult,
  Mention,
  SearchPage,
  SearchResult,
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

function buildCoverage(skipCount: boolean): Promise<{ rows: Array<{ processed: number; total: number }> } | null> {
  if (skipCount) return Promise.resolve(null);
  return pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
      COUNT(*)::int AS total
    FROM episodes`
  );
}

function toCoverage(coverageResult: { rows: Array<{ processed: number; total: number }> } | null): EpisodeCoverage {
  const cov = coverageResult?.rows[0];
  return {
    processed: cov?.processed ?? 0,
    total: cov?.total ?? 0,
  };
}

function buildMetadataSnippet(
  row: { episode_title: string | null; episode_description: string | null },
  parsed: ReturnType<typeof parseSearchQuery>
): string {
  if (parsed.titleFilter && row.episode_title) {
    return `Title match: ${row.episode_title}`;
  }
  if (parsed.descriptionFilter && row.episode_description) {
    const trimmed = row.episode_description.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
  }
  if (parsed.speakerFilter) {
    return `Speaker match: ${parsed.speakerFilter}`;
  }
  return row.episode_title ?? "Episode match";
}

interface FilterOpts {
  speakerLabel: string | null;
  speakerLike: string | null;
  titleFilter: string | null;
  descriptionFilter: string | null;
}

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

export async function searchGrouped(
  query: string,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  page: number,
  pageSize: number = 20,
  skipCount: boolean = false,
  speakerLabel: string | null = null
): Promise<GroupedSearchResult> {
  const parsed = parseSearchQuery(query);
  const speakerLike = buildLikePattern(parsed.speakerFilter);
  const filterOpts: FilterOpts = {
    speakerLabel,
    speakerLike,
    titleFilter: parsed.titleFilter,
    descriptionFilter: parsed.descriptionFilter,
  };
  const offset = (page - 1) * pageSize;

  if (parsed.mode === "metadata_only") {
    return searchGroupedMetadata(filterOpts, feedIds, includeManualUploads, pageSize, offset, skipCount);
  }

  const baseQuery = parsed.freeText || query.trim();
  return searchGroupedFts(baseQuery, filterOpts, feedIds, includeManualUploads, pageSize, offset, skipCount);
}

async function searchGroupedMetadata(
  filterOpts: FilterOpts,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  pageSize: number,
  offset: number,
  skipCount: boolean,
): Promise<GroupedSearchResult> {
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 1);
  const metaFilters = buildMetadataFilters(filterOpts, feedFilter.nextIdx);

  const whereClauses = ["e.status = 'done'", feedFilter.clause, ...metaFilters.clauses];
  const params = [...feedFilter.params, ...metaFilters.params];
  const idx = metaFilters.nextIdx;
  const whereSql = whereClauses.join("\n      AND ");

  const rowsPromise = pool.query(
    `SELECT
      f.id AS feed_id,
      COALESCE(f.title, 'Manual episode') AS feed_title,
      COALESCE(f.mode, 'full') AS feed_mode,
      e.id AS episode_id,
      e.title AS episode_title,
      e.audio_url,
      e.audio_local_path,
      e.episode_url,
      1::int AS mention_count,
      1::double precision AS best_rank
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
        `SELECT
          COUNT(*)::int AS total_episodes,
          COUNT(DISTINCT f.id)::int AS total_feeds,
          COUNT(*)::int AS total_mentions,
          BOOL_OR(e.feed_id IS NULL)::bool AS has_manual
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

  const counts = countResult?.rows[0];
  return {
    feeds: groupRowsByFeed(rowsResult.rows),
    totalFeeds: (counts?.total_feeds ?? -1) + (counts?.has_manual ? 1 : 0),
    totalEpisodes: counts?.total_episodes ?? -1,
    totalMentions: counts?.total_mentions ?? -1,
    coverage: toCoverage(coverageResult),
  };
}

async function searchGroupedFts(
  baseQuery: string,
  filterOpts: FilterOpts,
  feedIds: string[] | null,
  includeManualUploads: boolean,
  pageSize: number,
  offset: number,
  skipCount: boolean,
): Promise<GroupedSearchResult> {
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const rowsFilters = buildSpeakerTurnFilters(filterOpts, feedFilter.nextIdx);
  const rowsParams = [baseQuery, ...feedFilter.params, ...rowsFilters.params];

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
    LEFT JOIN feeds f ON e.feed_id = f.id
    LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = t.speaker_label,
      websearch_to_tsquery('english', $1) AS query
    WHERE to_tsvector('english', t.full_text) @@ query
      AND e.status = 'done'
      AND ${feedFilter.clause}
      ${appendFilterSql(rowsFilters.clauses)}
    GROUP BY f.id, f.title, f.mode, e.id, e.title, e.audio_url, e.audio_local_path, e.episode_url
    ORDER BY best_rank DESC, mention_count DESC
    LIMIT $${rowsFilters.nextIdx} OFFSET $${rowsFilters.nextIdx + 1}`,
    [...rowsParams, pageSize, offset]
  );

  const countFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countFilters = buildSpeakerTurnFilters(filterOpts, countFeedFilter.nextIdx);
  const countParams = [baseQuery, ...countFeedFilter.params, ...countFilters.params];

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
        LEFT JOIN feeds f ON e.feed_id = f.id
        LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = t.speaker_label,
          websearch_to_tsquery('english', $1) AS query
        WHERE to_tsvector('english', t.full_text) @@ query
          AND e.status = 'done'
          AND ${countFeedFilter.clause}
          ${appendFilterSql(countFilters.clauses)}`,
        countParams
      );

  const [rowsResult, countResult, coverageResult] = await Promise.all([
    rowsPromise,
    countPromise,
    buildCoverage(skipCount),
  ]);

  const counts = countResult?.rows[0];
  return {
    feeds: groupRowsByFeed(rowsResult.rows),
    totalFeeds: (counts?.total_feeds ?? -1) + (counts?.has_manual ? 1 : 0),
    totalEpisodes: counts?.total_episodes ?? -1,
    totalMentions: counts?.total_mentions ?? -1,
    coverage: toCoverage(coverageResult),
  };
}

export async function searchMentions(
  query: string,
  episodeId: string
): Promise<EpisodeMentions> {
  const parsed = parseSearchQuery(query);
  const baseQuery = parsed.freeText.trim();
  if (!baseQuery) return { episodeId, mentions: [] };

  const speakerLike = buildLikePattern(parsed.speakerFilter);
  const params: unknown[] = [baseQuery, episodeId];
  let idx = 3;
  let speakerMatchSql = "";

  if (speakerLike) {
    speakerMatchSql = ` AND (COALESCE(sn.display_name, t.speaker_label) ILIKE $${idx} OR t.speaker_label ILIKE $${idx})`;
    params.push(speakerLike);
    idx++;
  }

  const result = await pool.query(
    `WITH ${SPEAKER_TURNS_CTE}
    SELECT
      t.min_id AS id,
      t.start_time,
      t.end_time,
      t.speaker_label,
      COALESCE(sn.display_name, t.speaker_label) AS speaker_display,
      t.full_text,
      CASE WHEN to_tsvector('english', t.full_text) @@ query ${speakerMatchSql} THEN true ELSE false END AS is_match,
      CASE WHEN to_tsvector('english', t.full_text) @@ query ${speakerMatchSql}
        THEN ts_headline('english', t.full_text, query, 'MaxFragments=0, HighlightAll=true')
        ELSE '' END AS snippet,
      CASE WHEN to_tsvector('english', t.full_text) @@ query ${speakerMatchSql}
        THEN ts_rank(to_tsvector('english', t.full_text), query)
        ELSE 0 END AS rank
    FROM speaker_turns t
    LEFT JOIN speaker_names sn ON sn.episode_id = t.episode_id AND sn.speaker_label = t.speaker_label,
      websearch_to_tsquery('english', $1) AS query
    WHERE t.episode_id = $2
    ORDER BY t.start_time ASC`,
    params
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

  const mentions: Mention[] = matchIndices.map((matchIndex) => {
    const row = allTurns[matchIndex];

    const before: ContextSegment[] = [];
    for (let i = matchIndex - 1; i >= 0 && before.length < CONTEXT_SIZE; i--) {
      if (!allTurns[i].is_match) before.unshift(toContextSegment(allTurns[i]));
      else break;
    }

    const after: ContextSegment[] = [];
    for (let i = matchIndex + 1; i < allTurns.length && after.length < CONTEXT_SIZE; i++) {
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
