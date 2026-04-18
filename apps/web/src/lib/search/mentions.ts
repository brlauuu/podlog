import pool from "@/lib/db";
import { buildLikePattern } from "@/lib/search/filters";
import { parseSearchQuery } from "@/lib/search/queryParser";
import { SPEAKER_TURNS_CTE } from "@/lib/search/speakerTurns";
import type { ContextSegment, EpisodeMentions, Mention } from "@/lib/search/types";

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
