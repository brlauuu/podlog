import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import pool from "@/lib/db";
import SpeakerLabel from "@/components/SpeakerLabel";

interface Segment {
  id: number;
  start_time: number;
  end_time: number;
  speaker_label: string | null;
  display_name: string | null;
  text: string;
}

interface Episode {
  id: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
  status: string;
  has_diarization: boolean;
  diarization_error: string | null;
  feed_id: string | null;
  feed_title: string | null;
}

async function getEpisode(id: string): Promise<Episode | null> {
  const result = await pool.query(
    `SELECT e.*, f.title AS feed_title
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
            sn.display_name
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

  // Collect unique speaker labels for display
  const uniqueSpeakers = Array.from(
    new Set(segments.map((s) => s.speaker_label).filter(Boolean) as string[])
  );

  return (
    <div className="space-y-6">
      <div>
        {episode.feed_id && (
          <Link
            href={`/podcasts/${episode.feed_id}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {episode.feed_title ?? "Podcast"}
          </Link>
        )}
        <h1 className="text-xl font-semibold mt-2">{episode.title ?? "Untitled Episode"}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          {episode.published_at && (
            <span>{new Date(episode.published_at).toLocaleDateString()}</span>
          )}
          {episode.duration_secs && <span>{formatTime(episode.duration_secs)}</span>}
        </div>
      </div>

      {/* Diarization failure banner — PRD-02 §5.3 */}
      {!episode.has_diarization && episode.status === "done" && (
        <div className="flex items-start gap-2 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded-lg p-3">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Speaker labels unavailable — diarization failed
            {episode.diarization_error ? `: ${episode.diarization_error}` : ""}
          </p>
        </div>
      )}

      {/* Transcript */}
      <div className="space-y-3">
        {segments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {episode.status === "done"
              ? "No transcript segments found."
              : `Processing... (${episode.status})`}
          </p>
        ) : (
          segments.map((seg) => (
            <div key={seg.id} className="flex gap-3 group">
              <span className="text-xs text-muted-foreground font-mono shrink-0 mt-0.5 w-14 text-right">
                {formatTime(seg.start_time)}
              </span>
              <div className="flex-1 min-w-0">
                {episode.has_diarization && seg.speaker_label && (
                  <div className="mb-0.5">
                    {/* SpeakerLabel is a client component for inline editing */}
                    <span className="text-xs font-semibold text-primary">
                      {seg.display_name ?? seg.speaker_label}
                    </span>
                  </div>
                )}
                <p className="text-sm leading-relaxed">{seg.text}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
