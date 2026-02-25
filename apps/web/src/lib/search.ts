import pool from "@/lib/db";

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
