import Link from "next/link";
import pool from "@/lib/db";
import { Separator } from "@/components/ui/separator";
import UploadsSection, { type UploadedEpisode } from "@/components/UploadsSection";
import PodcastsList, { type PodcastsListFeed } from "@/components/PodcastsList";

export const dynamic = "force-dynamic";

async function getFeeds(): Promise<PodcastsListFeed[]> {
  const result = await pool.query(`
    SELECT
      f.id,
      f.title,
      f.description,
      f.image_url,
      f.mode,
      f.last_polled_at,
      COUNT(e.id)::int AS episode_count,
      COUNT(e.id) FILTER (WHERE e.status = 'done')::int AS processed_count
    FROM feeds f
    LEFT JOIN episodes e ON e.feed_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `);
  return result.rows;
}

async function getUploadedEpisodes(): Promise<{
  episodes: UploadedEpisode[];
  processed: number;
  total: number;
}> {
  const result = await pool.query(
    `SELECT
       e.id, e.title, e.description,
       e.published_at, e.processed_at,
       e.duration_secs, e.language, e.status, e.has_diarization,
       e.diarization_error, e.error_class, e.error_message,
       COALESCE(e.retry_count, 0) AS retry_count,
       COALESCE(e.retry_max, 3) AS retry_max,
       e.transcribe_duration_secs, e.diarize_duration_secs,
       e.inference_provider_used,
       e.fireworks_audio_minutes,
       e.fireworks_stt_cost_usd,
       e.pyannote_cloud_cost_usd,
       e.created_at,
       COALESCE(agg.speaker_count, 0)::int AS speaker_count,
       COALESCE(sn_agg.speaker_name_tags, '[]'::json) AS speaker_name_tags
     FROM episodes e
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT s.speaker_label)::int AS speaker_count
       FROM segments s
       WHERE s.episode_id = e.id
     ) agg ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'display_name', sn.display_name,
           'inferred', sn.inferred,
           'confirmed_by_user', sn.confirmed_by_user
         ) ORDER BY sn.display_name
       ) FILTER (WHERE sn.id IS NOT NULL) AS speaker_name_tags
       FROM speaker_names sn
       WHERE sn.episode_id = e.id
         AND EXISTS (
           SELECT 1
           FROM segments s2
           WHERE s2.episode_id = e.id
             AND s2.speaker_label = sn.speaker_label
         )
     ) sn_agg ON true
     WHERE e.feed_id IS NULL
     ORDER BY e.created_at DESC`
  );
  const episodes: UploadedEpisode[] = result.rows;
  const processed = episodes.filter((e) => e.status === "done").length;
  return { episodes, processed, total: episodes.length };
}

export default async function SourcesPage() {
  const [feeds, uploads] = await Promise.all([getFeeds(), getUploadedEpisodes()]);

  return (
    <div className="space-y-6">
      {feeds.length > 0 && <PodcastsList feeds={feeds} />}

      {feeds.length === 0 && uploads.total === 0 && (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No sources yet.</p>
          <Link href="/feeds" className="text-sm text-link underline">
            Add your first RSS feed
          </Link>
          <p className="text-xs text-muted-foreground">or upload an audio file below</p>
        </div>
      )}

      <Separator />

      <UploadsSection
        uploads={uploads.episodes}
        processed={uploads.processed}
        total={uploads.total}
      />
    </div>
  );
}
