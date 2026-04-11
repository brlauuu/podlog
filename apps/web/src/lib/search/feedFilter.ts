export interface FeedFilter {
  clause: string;
  params: unknown[];
  nextIdx: number;
}

/**
 * Build a SQL WHERE clause fragment for feed filtering.
 * Handles: no filter, feed UUIDs only, manual uploads only, or both.
 */
export function buildFeedFilter(
  feedIds: string[] | null,
  includeManualUploads: boolean,
  startParam: number
): FeedFilter {
  const hasFeedIds = feedIds && feedIds.length > 0;
  if (!hasFeedIds && !includeManualUploads) {
    return { clause: "TRUE", params: [], nextIdx: startParam };
  }

  const parts: string[] = [];
  const params: unknown[] = [];
  if (hasFeedIds) {
    parts.push(`f.id = ANY($${startParam}::uuid[])`);
    params.push(feedIds);
    startParam++;
  }
  if (includeManualUploads) {
    parts.push("e.feed_id IS NULL");
  }

  return {
    clause: `(${parts.join(" OR ")})`,
    params,
    nextIdx: startParam,
  };
}
