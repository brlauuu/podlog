import Link from "next/link";
import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import pool from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import EpisodesList, { type EnrichedEpisode } from "@/components/EpisodesList";

export const dynamic = "force-dynamic";

interface Feed {
  id: string;
  title: string | null;
  image_url: string | null;
  website_url: string | null;
  mode: string;
}

async function getFeed(id: string): Promise<Feed | null> {
  const result = await pool.query("SELECT * FROM feeds WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

async function getEpisodes(feedId: string): Promise<EnrichedEpisode[]> {
  const result = await pool.query(
    `SELECT
       e.id, e.title, e.published_at, e.processed_at,
       e.duration_secs, e.language, e.status, e.has_diarization,
       e.diarization_error, e.error_class, e.error_message,
       COALESCE(e.retry_count, 0) AS retry_count,
       COALESCE(e.retry_max, 3) AS retry_max,
       e.transcribe_duration_secs, e.diarize_duration_secs,
       e.inference_provider_used,
       e.fireworks_audio_minutes,
       e.fireworks_stt_cost_usd,
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
     ) sn_agg ON true
     WHERE e.feed_id = $1
     ORDER BY e.published_at DESC NULLS LAST`,
    [feedId]
  );
  return result.rows;
}

export default async function PodcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [feed, episodes] = await Promise.all([getFeed(id), getEpisodes(id)]);

  if (!feed) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/podcasts" className="text-sm text-muted-foreground hover:text-foreground">
          ← Podcasts
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-semibold">{feed.title ?? "Untitled podcast"}</h1>
          {feed.mode === "test" && (
            <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-1">
              <FlaskConical size={12} />
              Test
            </Badge>
          )}
        </div>
      </div>

      <EpisodesList episodes={episodes} feedId={feed.id} />
    </div>
  );
}
