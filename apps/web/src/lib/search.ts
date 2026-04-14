import pool from "@/lib/db";
import { PIPELINE_API } from "@/lib/pipeline";
import { buildFeedFilter } from "@/lib/search/feedFilter";
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

function buildLikePattern(value: string | null): string | null {
  if (!value) return null;
  return `%${value}%`;
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
  const parsed = parseSearchQuery(query);
  const speakerLike = buildLikePattern(parsed.speakerFilter);

  if (parsed.mode === "metadata_only") {
    const offset = (page - 1) * pageSize;
    const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 1);
    const whereClauses: string[] = ["e.status = 'done'", feedFilter.clause];
    const params: unknown[] = [...feedFilter.params];
    let idx = feedFilter.nextIdx;

    if (parsed.titleFilter) {
      whereClauses.push(`COALESCE(e.title, '') ILIKE $${idx}`);
      params.push(buildLikePattern(parsed.titleFilter));
      idx++;
    }
    if (parsed.descriptionFilter) {
      whereClauses.push(`COALESCE(e.description, '') ILIKE $${idx}`);
      params.push(buildLikePattern(parsed.descriptionFilter));
      idx++;
    }
    if (speakerLike) {
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM speaker_names sn
          WHERE sn.episode_id = e.id
            AND (COALESCE(sn.display_name, sn.speaker_label) ILIKE $${idx} OR sn.speaker_label ILIKE $${idx})
        )`
      );
      params.push(speakerLike);
      idx++;
    }
    if (speakerLabel) {
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM speaker_names sn
          WHERE sn.episode_id = e.id
            AND sn.confirmed_by_user = true
            AND sn.display_name = $${idx}
        )`
      );
      params.push(speakerLabel);
      idx++;
    }

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

  const baseQuery = parsed.freeText || query.trim();
  const FETCH_LIMIT = 100;

  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const ftsExtraClauses: string[] = [];
  const ftsParams: unknown[] = [baseQuery, ...feedFilter.params];
  let ftsIdx = feedFilter.nextIdx;

  if (speakerLabel) {
    ftsExtraClauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${ftsIdx}`);
    ftsParams.push(speakerLabel);
    ftsIdx++;
  }
  if (speakerLike) {
    ftsExtraClauses.push(`(COALESCE(sn.display_name, t.speaker_label) ILIKE $${ftsIdx} OR t.speaker_label ILIKE $${ftsIdx})`);
    ftsParams.push(speakerLike);
    ftsIdx++;
  }
  if (parsed.titleFilter) {
    ftsExtraClauses.push(`COALESCE(e.title, '') ILIKE $${ftsIdx}`);
    ftsParams.push(buildLikePattern(parsed.titleFilter));
    ftsIdx++;
  }
  if (parsed.descriptionFilter) {
    ftsExtraClauses.push(`COALESCE(e.description, '') ILIKE $${ftsIdx}`);
    ftsParams.push(buildLikePattern(parsed.descriptionFilter));
    ftsIdx++;
  }

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
      ${ftsExtraClauses.length ? `AND ${ftsExtraClauses.join(" AND ")}` : ""}
    ORDER BY rank DESC
    LIMIT $${ftsIdx}`,
    [...ftsParams, FETCH_LIMIT]
  );

  const embedding = await getQueryEmbedding(baseQuery);
  const vecFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const vecParams: unknown[] = [`[${embedding?.join(",")}]`, ...vecFeedFilter.params];
  const vecExtraClauses: string[] = [];
  let vecIdx = vecFeedFilter.nextIdx;

  if (speakerLabel) {
    vecExtraClauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${vecIdx}`);
    vecParams.push(speakerLabel);
    vecIdx++;
  }
  if (speakerLike) {
    vecExtraClauses.push(`(COALESCE(sn.display_name, s.speaker_label) ILIKE $${vecIdx} OR s.speaker_label ILIKE $${vecIdx})`);
    vecParams.push(speakerLike);
    vecIdx++;
  }
  if (parsed.titleFilter) {
    vecExtraClauses.push(`COALESCE(e.title, '') ILIKE $${vecIdx}`);
    vecParams.push(buildLikePattern(parsed.titleFilter));
    vecIdx++;
  }
  if (parsed.descriptionFilter) {
    vecExtraClauses.push(`COALESCE(e.description, '') ILIKE $${vecIdx}`);
    vecParams.push(buildLikePattern(parsed.descriptionFilter));
    vecIdx++;
  }

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
          ${vecExtraClauses.length ? `AND ${vecExtraClauses.join(" AND ")}` : ""}
        ORDER BY s.embedding <=> $1::vector
        LIMIT $${vecIdx}`,
        [...vecParams, FETCH_LIMIT]
      )
    : Promise.resolve({ rows: [] });

  const countFeedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countParams: unknown[] = [baseQuery, ...countFeedFilter.params];
  const countExtraClauses: string[] = [];
  let countIdx = countFeedFilter.nextIdx;

  if (speakerLabel) {
    countExtraClauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${countIdx}`);
    countParams.push(speakerLabel);
    countIdx++;
  }
  if (speakerLike) {
    countExtraClauses.push(`(COALESCE(sn.display_name, t.speaker_label) ILIKE $${countIdx} OR t.speaker_label ILIKE $${countIdx})`);
    countParams.push(speakerLike);
    countIdx++;
  }
  if (parsed.titleFilter) {
    countExtraClauses.push(`COALESCE(e.title, '') ILIKE $${countIdx}`);
    countParams.push(buildLikePattern(parsed.titleFilter));
    countIdx++;
  }
  if (parsed.descriptionFilter) {
    countExtraClauses.push(`COALESCE(e.description, '') ILIKE $${countIdx}`);
    countParams.push(buildLikePattern(parsed.descriptionFilter));
    countIdx++;
  }

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
          ${countExtraClauses.length ? `AND ${countExtraClauses.join(" AND ")}` : ""}`,
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
  const parsed = parseSearchQuery(query);
  const speakerLike = buildLikePattern(parsed.speakerFilter);
  const offset = (page - 1) * pageSize;

  if (parsed.mode === "metadata_only") {
    const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 1);
    const whereClauses: string[] = ["e.status = 'done'", feedFilter.clause];
    const params: unknown[] = [...feedFilter.params];
    let idx = feedFilter.nextIdx;

    if (parsed.titleFilter) {
      whereClauses.push(`COALESCE(e.title, '') ILIKE $${idx}`);
      params.push(buildLikePattern(parsed.titleFilter));
      idx++;
    }
    if (parsed.descriptionFilter) {
      whereClauses.push(`COALESCE(e.description, '') ILIKE $${idx}`);
      params.push(buildLikePattern(parsed.descriptionFilter));
      idx++;
    }
    if (speakerLike) {
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM speaker_names sn
          WHERE sn.episode_id = e.id
            AND (COALESCE(sn.display_name, sn.speaker_label) ILIKE $${idx} OR sn.speaker_label ILIKE $${idx})
        )`
      );
      params.push(speakerLike);
      idx++;
    }
    if (speakerLabel) {
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM speaker_names sn
          WHERE sn.episode_id = e.id
            AND sn.confirmed_by_user = true
            AND sn.display_name = $${idx}
        )`
      );
      params.push(speakerLabel);
      idx++;
    }

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

  const baseQuery = parsed.freeText || query.trim();
  const feedFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const rowsParams: unknown[] = [baseQuery, ...feedFilter.params];
  const rowsExtraClauses: string[] = [];
  let rowsIdx = feedFilter.nextIdx;

  if (speakerLabel) {
    rowsExtraClauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${rowsIdx}`);
    rowsParams.push(speakerLabel);
    rowsIdx++;
  }
  if (speakerLike) {
    rowsExtraClauses.push(`(COALESCE(sn.display_name, t.speaker_label) ILIKE $${rowsIdx} OR t.speaker_label ILIKE $${rowsIdx})`);
    rowsParams.push(speakerLike);
    rowsIdx++;
  }
  if (parsed.titleFilter) {
    rowsExtraClauses.push(`COALESCE(e.title, '') ILIKE $${rowsIdx}`);
    rowsParams.push(buildLikePattern(parsed.titleFilter));
    rowsIdx++;
  }
  if (parsed.descriptionFilter) {
    rowsExtraClauses.push(`COALESCE(e.description, '') ILIKE $${rowsIdx}`);
    rowsParams.push(buildLikePattern(parsed.descriptionFilter));
    rowsIdx++;
  }

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
      ${rowsExtraClauses.length ? `AND ${rowsExtraClauses.join(" AND ")}` : ""}
    GROUP BY f.id, f.title, f.mode, e.id, e.title, e.audio_url, e.audio_local_path, e.episode_url
    ORDER BY best_rank DESC, mention_count DESC
    LIMIT $${rowsIdx} OFFSET $${rowsIdx + 1}`,
    [...rowsParams, pageSize, offset]
  );

  const grpCountFilter = buildFeedFilter(feedIds, includeManualUploads, 2);
  const countParams: unknown[] = [baseQuery, ...grpCountFilter.params];
  const countExtraClauses: string[] = [];
  let countIdx = grpCountFilter.nextIdx;

  if (speakerLabel) {
    countExtraClauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${countIdx}`);
    countParams.push(speakerLabel);
    countIdx++;
  }
  if (speakerLike) {
    countExtraClauses.push(`(COALESCE(sn.display_name, t.speaker_label) ILIKE $${countIdx} OR t.speaker_label ILIKE $${countIdx})`);
    countParams.push(speakerLike);
    countIdx++;
  }
  if (parsed.titleFilter) {
    countExtraClauses.push(`COALESCE(e.title, '') ILIKE $${countIdx}`);
    countParams.push(buildLikePattern(parsed.titleFilter));
    countIdx++;
  }
  if (parsed.descriptionFilter) {
    countExtraClauses.push(`COALESCE(e.description, '') ILIKE $${countIdx}`);
    countParams.push(buildLikePattern(parsed.descriptionFilter));
    countIdx++;
  }

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
          AND ${grpCountFilter.clause}
          ${countExtraClauses.length ? `AND ${countExtraClauses.join(" AND ")}` : ""}`,
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

/**
 * Fetch matching speaker turns for one episode with surrounding context.
 * Returns 1-2 turns before and after each match for dialogue context.
 */
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
