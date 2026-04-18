import pool from "@/lib/db";
import { buildFeedFilter } from "@/lib/search/feedFilter";
import {
  appendFilterSql,
  buildLikePattern,
  buildMetadataFilters,
  buildSpeakerTurnFilters,
} from "@/lib/search/filters";
import { buildCoverage, toCoverage } from "@/lib/search/coverage";
import { type FilterOpts } from "@/lib/search/filterOpts";
import { groupRowsByFeed } from "@/lib/search/grouping";
import { parseSearchQuery } from "@/lib/search/queryParser";
import { SPEAKER_TURNS_CTE } from "@/lib/search/speakerTurns";
import type { GroupedSearchResult } from "@/lib/search/types";

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
