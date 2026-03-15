import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import pool from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import TranscriptView from "@/components/TranscriptView";
import EpisodeDescription from "@/components/EpisodeDescription";
import TranscriptExportButton from "@/components/TranscriptExportButton";

export const dynamic = "force-dynamic";

interface Segment {
  id: number;
  start_time: number;
  end_time: number;
  speaker_label: string | null;
  display_name: string | null;
  inferred: boolean;
  confirmed_by_user: boolean;
  text: string;
}

interface Episode {
  id: string;
  title: string | null;
  description: string | null;
  published_at: string | null;
  duration_secs: number | null;
  status: string;
  has_diarization: boolean;
  diarization_error: string | null;
  inference_error: string | null;
  transcribe_duration_secs: number | null;
  diarize_duration_secs: number | null;
  audio_url: string | null;
  audio_local_path: string | null;
  guid: string | null;
  feed_id: string | null;
  feed_title: string | null;
  feed_description: string | null;
  feed_image_url: string | null;
  feed_website_url: string | null;
  feed_url: string | null;
}

async function getEpisode(id: string): Promise<Episode | null> {
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

async function getSegments(episodeId: string): Promise<Segment[]> {
  const result = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.speaker_label, s.text,
            sn.display_name,
            COALESCE(sn.inferred, false) AS inferred,
            COALESCE(sn.confirmed_by_user, false) AS confirmed_by_user
     FROM segments s
     LEFT JOIN speaker_names sn ON sn.episode_id = s.episode_id
       AND sn.speaker_label = s.speaker_label
     WHERE s.episode_id = $1
     ORDER BY s.start_time`,
    [episodeId]
  );
  return result.rows;
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function EpisodePage({ params }: { params: { id: string } }) {
  const [episode, segments] = await Promise.all([getEpisode(params.id), getSegments(params.id)]);

  if (!episode) notFound();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        {episode.feed_id && (
          <Link
            href={`/podcasts/${episode.feed_id}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; {episode.feed_title ?? "Podcast"}
          </Link>
        )}
        <h1 className="text-xl font-semibold mt-2">{episode.title ?? "Untitled Episode"}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          {episode.published_at && (
            <span>{new Date(episode.published_at).toLocaleDateString()}</span>
          )}
          {episode.duration_secs && <span>{formatTime(episode.duration_secs)}</span>}
        </div>
        {(episode.transcribe_duration_secs || episode.diarize_duration_secs) && (
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {episode.transcribe_duration_secs != null && (
              <span>Transcription: {formatTime(episode.transcribe_duration_secs)}</span>
            )}
            {episode.diarize_duration_secs != null && (
              <span>Diarization: {formatTime(episode.diarize_duration_secs)}</span>
            )}
          </div>
        )}
      </div>

      {/* Podcast context card */}
      {episode.feed_id && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            {episode.feed_image_url && (
              <img
                src={episode.feed_image_url}
                alt={episode.feed_title ?? "Podcast artwork"}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
            )}
            <div className="text-sm">
              <Link
                href={`/podcasts/${episode.feed_id}`}
                className="font-medium hover:underline"
              >
                {episode.feed_title ?? "Podcast"}
              </Link>
              {episode.feed_website_url && (
                <a
                  href={episode.feed_website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {episode.feed_website_url}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Episode description */}
      {episode.description && (
        <EpisodeDescription description={episode.description} />
      )}

      {/* Diarization failure banner — PRD-02 §5.3 */}
      {!episode.has_diarization && episode.status === "done" && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Speaker labels unavailable — diarization failed
              {episode.diarization_error ? `: ${episode.diarization_error}` : ""}
            </p>
          </CardContent>
        </Card>
      )}

      {/* PRD-04 §8.1: inference error banner */}
      {episode.inference_error && episode.status === "done" && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
          <CardContent className="p-3 flex items-start gap-2">
            <Info size={16} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Speaker name inference was unavailable for this episode.
            </p>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Transcript header with export */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
        {segments.length > 0 && (
          <TranscriptExportButton
            episodeTitle={episode.title ?? "Untitled Episode"}
            feedTitle={episode.feed_title}
            publishedAt={episode.published_at}
            durationSecs={episode.duration_secs}
            description={episode.description}
            feedUrl={episode.feed_url}
            feedWebsiteUrl={episode.feed_website_url}
            feedDescription={episode.feed_description}
            audioUrl={episode.audio_url}
            guid={episode.guid}
            segments={segments}
          />
        )}
      </div>

      {/* Transcript — PRD-04 §8.1: inferred/confirmed badges on speaker labels */}
      <TranscriptView
        episodeId={episode.id}
        hasDiarization={episode.has_diarization}
        status={episode.status}
        segments={segments}
        audioLocalPath={episode.audio_local_path}
        episodeTitle={episode.title}
        feedTitle={episode.feed_title}
      />
    </div>
  );
}
