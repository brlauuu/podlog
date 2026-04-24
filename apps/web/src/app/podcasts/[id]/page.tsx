import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { FlaskConical, ExternalLink } from "lucide-react";
import pool from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import EpisodesList, { type EnrichedEpisode } from "@/components/EpisodesList";

export const dynamic = "force-dynamic";

interface Feed {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  website_url: string | null;
  mode: string;
}

async function getFeed(id: string): Promise<Feed | null> {
  const result = await pool.query(
    "SELECT id, title, description, image_url, website_url, mode FROM feeds WHERE id = $1",
    [id]
  );
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
       e.pyannote_cloud_cost_usd,
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

        <Card className="mt-4 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col sm:flex-row gap-4 p-4">
              {/* Podcast Image */}
              {feed.image_url ? (
                <Image
                  src={feed.image_url}
                  alt={feed.title ?? "Podcast"}
                  width={150}
                  height={150}
                  className="w-32 h-32 sm:w-36 sm:h-36 object-cover rounded-md shrink-0"
                />
              ) : (
                <div className="w-32 h-32 sm:w-36 sm:h-36 bg-muted flex items-center justify-center text-4xl rounded-md shrink-0">
                  🎙
                </div>
              )}

              {/* Podcast Info */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-semibold">{feed.title ?? "Untitled podcast"}</h1>
                  {feed.mode === "test" && (
                    <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-1">
                      <FlaskConical size={12} />
                      Test
                    </Badge>
                  )}
                </div>

                {feed.website_url && (
                  <a
                    href={feed.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-link hover:underline"
                  >
                    <ExternalLink size={14} />
                    {new URL(feed.website_url).hostname.replace(/^www\./, "")}
                  </a>
                )}

                {feed.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feed.description}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <EpisodesList episodes={episodes} feedId={feed.id} />
    </div>
  );
}
