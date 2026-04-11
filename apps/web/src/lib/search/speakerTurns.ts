// Assigns a turn number to each segment based on consecutive same-speaker
// runs within an episode. Used by all search functions to deduplicate
// results: one hit per speaker turn instead of one per segment.
export const SPEAKER_TURNS_CTE = `
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
