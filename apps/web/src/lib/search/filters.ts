export interface FilterResult {
  clauses: string[];
  params: unknown[];
  nextIdx: number;
}

interface FilterOptions {
  speakerLabel: string | null;
  speakerLike: string | null;
  titleFilter: string | null;
  descriptionFilter: string | null;
}

function buildLikePattern(value: string | null): string | null {
  if (!value) return null;
  return `%${value}%`;
}

export function buildSpeakerTurnFilters(
  opts: FilterOptions,
  startIdx: number,
): FilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = startIdx;

  if (opts.speakerLabel) {
    clauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${idx}`);
    params.push(opts.speakerLabel);
    idx++;
  }
  if (opts.speakerLike) {
    clauses.push(`(COALESCE(sn.display_name, t.speaker_label) ILIKE $${idx} OR t.speaker_label ILIKE $${idx})`);
    params.push(opts.speakerLike);
    idx++;
  }
  if (opts.titleFilter) {
    clauses.push(`COALESCE(e.title, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.titleFilter));
    idx++;
  }
  if (opts.descriptionFilter) {
    clauses.push(`COALESCE(e.description, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.descriptionFilter));
    idx++;
  }

  return { clauses, params, nextIdx: idx };
}

export function buildSegmentFilters(
  opts: FilterOptions,
  startIdx: number,
): FilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = startIdx;

  if (opts.speakerLabel) {
    clauses.push(`sn.confirmed_by_user = true AND sn.display_name = $${idx}`);
    params.push(opts.speakerLabel);
    idx++;
  }
  if (opts.speakerLike) {
    clauses.push(`(COALESCE(sn.display_name, s.speaker_label) ILIKE $${idx} OR s.speaker_label ILIKE $${idx})`);
    params.push(opts.speakerLike);
    idx++;
  }
  if (opts.titleFilter) {
    clauses.push(`COALESCE(e.title, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.titleFilter));
    idx++;
  }
  if (opts.descriptionFilter) {
    clauses.push(`COALESCE(e.description, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.descriptionFilter));
    idx++;
  }

  return { clauses, params, nextIdx: idx };
}

export function buildMetadataFilters(
  opts: FilterOptions,
  startIdx: number,
): FilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = startIdx;

  if (opts.titleFilter) {
    clauses.push(`COALESCE(e.title, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.titleFilter));
    idx++;
  }
  if (opts.descriptionFilter) {
    clauses.push(`COALESCE(e.description, '') ILIKE $${idx}`);
    params.push(buildLikePattern(opts.descriptionFilter));
    idx++;
  }
  if (opts.speakerLike) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM speaker_names sn
        WHERE sn.episode_id = e.id
          AND (COALESCE(sn.display_name, sn.speaker_label) ILIKE $${idx} OR sn.speaker_label ILIKE $${idx})
      )`
    );
    params.push(opts.speakerLike);
    idx++;
  }
  if (opts.speakerLabel) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM speaker_names sn
        WHERE sn.episode_id = e.id
          AND sn.confirmed_by_user = true
          AND sn.display_name = $${idx}
      )`
    );
    params.push(opts.speakerLabel);
    idx++;
  }

  return { clauses, params, nextIdx: idx };
}

export function appendFilterSql(clauses: string[]): string {
  if (clauses.length === 0) return "";
  return `AND ${clauses.join(" AND ")}`;
}

export { buildLikePattern };
