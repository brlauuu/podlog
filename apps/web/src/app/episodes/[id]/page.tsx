import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import pool from "@/lib/db";
import type { Segment } from "@/lib/types";
import { formatTimestamp } from "@/lib/timestamp";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import EpisodeDescription from "@/components/EpisodeDescription";
import TranscriptSection from "@/components/TranscriptSection";
import BackToSearchLink from "@/components/BackToSearchLink";
import ReprocessButton from "@/components/ReprocessButton";
import EpisodeChat from "@/components/EpisodeChat";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  if (status === "done") return null;

  const isFailed = status === "failed";
  const label = isFailed ? "Failed" : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Badge
      variant="outline"
      className={
        isFailed
          ? "text-red-700 border-red-300 dark:text-red-300 dark:border-red-700 gap-1"
          : "text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-700 gap-1"
      }
    >
      {isFailed ? (
        <XCircle size={12} />
      ) : (
        <Loader2 size={12} className="animate-spin" />
      )}
      {label}
    </Badge>
  );
}

interface Episode {
  id: string;
  title: string | null;
  description: string | null;
  published_at: string | null;
  duration_secs: number | null;
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

const STEP_ABBREVIATIONS: Record<string, string> = {
  io: "I/O", api: "API", stt: "STT", url: "URL",
};

function formatDiarizeStepLabel(key: string): string {
  const words = key.replace(/_secs$/, "").split("_").filter(Boolean);
  if (!words.length) return key;
  const formatted = words.map(w => STEP_ABBREVIATIONS[w.toLowerCase()] ?? w.toLowerCase());
  const label = formatted.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface AdjacentEpisode {
  id: string;
  title: string | null;
}

async function getAdjacentEpisodes(
  episode: Episode
): Promise<{ prev: AdjacentEpisode | null; next: AdjacentEpisode | null }> {
  const orderExpr = "COALESCE(published_at, created_at)";
  const orderVal = episode.published_at ?? episode.created_at;
  const feedCondition = episode.feed_id ? "feed_id = $2" : "feed_id IS NULL";
  const idParam = episode.feed_id ? "$3" : "$2";
  const params = episode.feed_id
    ? [orderVal, episode.feed_id, episode.id]
    : [orderVal, episode.id];

  const [prevResult, nextResult] = await Promise.all([
    pool.query(
      `SELECT id, title FROM episodes
       WHERE ${feedCondition}
         AND status = 'done'
         AND id <> ${idParam}
         AND (${orderExpr} < $1 OR (${orderExpr} = $1 AND id < ${idParam}))
       ORDER BY ${orderExpr} DESC, id DESC
       LIMIT 1`,
      params
    ),
    pool.query(
      `SELECT id, title FROM episodes
       WHERE ${feedCondition}
         AND status = 'done'
         AND id <> ${idParam}
         AND (${orderExpr} > $1 OR (${orderExpr} = $1 AND id > ${idParam}))
       ORDER BY ${orderExpr} ASC, id ASC
       LIMIT 1`,
      params
    ),
  ]);

  return {
    prev: prevResult.rows[0] ?? null,
    next: nextResult.rows[0] ?? null,
  };
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


export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [episode, segments] = await Promise.all([getEpisode(id), getSegments(id)]);

  if (!episode) notFound();

  const { prev, next } = await getAdjacentEpisodes(episode);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Suspense fallback={null}>
          <BackToSearchLink />
        </Suspense>
        {episode.feed_id && (
          <Link
            href={`/podcasts/${episode.feed_id}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; {episode.feed_title ?? "Podcast"}
          </Link>
        )}
        <div className="mt-2 space-y-2">
          <h1 className="text-xl font-semibold">{episode.title ?? "Untitled Episode"}</h1>
          <div className="flex items-center gap-3">
            <StatusBadge status={episode.status} />
            <ReprocessButton episodeId={episode.id} status={episode.status} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          {episode.published_at && (
            <span>{new Date(episode.published_at).toLocaleDateString()}</span>
          )}
          {episode.duration_secs && <span>{formatTimestamp(episode.duration_secs)}</span>}
        </div>
        {(episode.transcribe_duration_secs || episode.diarize_duration_secs) && (
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {episode.transcribe_duration_secs != null && (
              <span>Transcription: {formatTimestamp(episode.transcribe_duration_secs)}</span>
            )}
            {episode.diarize_duration_secs != null && (
              <span>Diarization: {formatTimestamp(episode.diarize_duration_secs)}</span>
            )}
          </div>
        )}
        {episode.diarize_step_durations && Object.keys(episode.diarize_step_durations).length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="mr-1">Diarization steps:</span>
            {Object.entries(episode.diarize_step_durations).map(([step, secs], idx) => (
              <span key={step}>
                {idx > 0 ? " · " : ""}
                {formatDiarizeStepLabel(step)}: {formatTimestamp(secs)}
              </span>
            ))}
          </div>
        )}
        {episode.inference_provider_used === "fireworks" && (
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
            {episode.fireworks_audio_minutes != null && (
              <span>Fireworks audio: {episode.fireworks_audio_minutes.toFixed(2)} min</span>
            )}
            {episode.fireworks_stt_cost_usd != null && (
              <span>Est. Fireworks STT cost: ${episode.fireworks_stt_cost_usd.toFixed(4)}</span>
            )}
            {episode.fireworks_stt_cost_per_minute_usd != null && (
              <span>Rate: ${episode.fireworks_stt_cost_per_minute_usd.toFixed(4)}/min</span>
            )}
          </div>
        )}
      </div>

      {/* Episode navigation */}
      {(prev || next) && (
        <div className="flex gap-2">
          {prev && (
            <Link
              href={`/episodes/${prev.id}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors min-w-0 flex-1 max-w-[50%]"
            >
              <ChevronLeft size={16} className="shrink-0" />
              <span className="flex-1 min-w-0 truncate">{prev.title ?? "Previous episode"}</span>
            </Link>
          )}
          {next && (
            <Link
              href={`/episodes/${next.id}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors min-w-0 flex-1 max-w-[50%]"
            >
              <span className="flex-1 min-w-0 truncate">{next.title ?? "Next episode"}</span>
              <ChevronRight size={16} className="shrink-0" />
            </Link>
          )}
        </div>
      )}

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
        <EpisodeDescription
          description={episode.description}
          episodeId={episode.id}
          audioLocalPath={episode.audio_local_path}
          episodeTitle={episode.title}
          feedTitle={episode.feed_title}
        />
      )}

      {/* Processing failure banner */}
      {episode.status === "failed" && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
          <CardContent className="p-3 flex items-start gap-2">
            <XCircle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p>Processing failed{episode.error_class ? ` (${episode.error_class})` : ""}</p>
              {episode.error_message && (
                <p className="mt-1 text-xs opacity-80">{episode.error_message}</p>
              )}
            </div>
          </CardContent>
        </Card>
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

      {/* PRD-04 §8.1: inference error banner — suppress if any segment has inferred names (#56) */}
      {episode.inference_error && episode.status === "done" && !segments.some(s => s.inferred) && (
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

      <TranscriptSection
        episodeId={episode.id}
        hasDiarization={episode.has_diarization}
        status={episode.status}
        segments={segments}
        audioLocalPath={episode.audio_local_path}
        episodeTitle={episode.title}
        feedTitle={episode.feed_title}
        publishedAt={episode.published_at}
        durationSecs={episode.duration_secs}
        description={episode.description}
        feedUrl={episode.feed_url}
        feedWebsiteUrl={episode.feed_website_url}
        feedDescription={episode.feed_description}
        audioUrl={episode.audio_url}
        guid={episode.guid}
      />

      {episode.status === "done" && (
        <EpisodeChat
          key={episode.id}
          episodeId={episode.id}
          episodeTitle={episode.title ?? "Untitled Episode"}
        />
      )}
    </div>
  );
}
