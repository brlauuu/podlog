/**
 * Episode + segment loaders shared by the episode page and the transcript
 * export route (#1037). Moved out of app/episodes/[id]/page.tsx unchanged.
 */
import pool from "@/lib/db";
import type { Segment } from "@/lib/types";

export interface Episode {
  id: string;
  title: string | null;
  description: string | null;
  published_at: string | null;
  duration_secs: number | null;
  language: string | null;
  status: string;
  error_class: string | null;
  error_message: string | null;
  has_diarization: boolean;
  diarization_error: string | null;
  inference_error: string | null;
  transcribe_duration_secs: number | null;
  diarize_duration_secs: number | null;
  diarize_step_durations: Record<string, number> | null;
  inference_provider_used: string | null;
  fireworks_audio_secs: number | null;
  fireworks_audio_minutes: number | null;
  fireworks_stt_cost_per_minute_usd: number | null;
  fireworks_stt_cost_usd: number | null;
  pyannote_cloud_cost_usd: number | null;
  audio_file_size_bytes: number | null;
  audio_url: string | null;
  audio_local_path: string | null;
  guid: string | null;
  feed_id: string | null;
  feed_title: string | null;
  feed_description: string | null;
  feed_image_url: string | null;
  feed_website_url: string | null;
  created_at: string;
  feed_url: string | null;
}

export async function getEpisode(id: string): Promise<Episode | null> {
  const result = await pool.query(
    `SELECT e.*, f.title AS feed_title,
            f.description AS feed_description,
            f.image_url AS feed_image_url,
            f.website_url AS feed_website_url,
            f.url AS feed_url
     FROM episodes e
     LEFT JOIN feeds f ON f.id = e.feed_id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getSegments(episodeId: string): Promise<Segment[]> {
  const result = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.speaker_label, s.text,
            sn.display_name,
            COALESCE(sn.inferred, false) AS inferred,
            COALESCE(sn.confirmed_by_user, false) AS confirmed_by_user,
            sn.role
     FROM segments s
     LEFT JOIN speaker_names sn ON sn.episode_id = s.episode_id
       AND sn.speaker_label = s.speaker_label
     WHERE s.episode_id = $1
     ORDER BY s.start_time`,
    [episodeId]
  );
  return result.rows;
}
