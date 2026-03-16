"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  MessageSquare,
  RotateCcw,
  Users,
} from "lucide-react";

export interface EnrichedEpisode {
  id: string;
  title: string | null;
  description: string | null;
  published_at: string | null;
  processed_at: string | null;
  duration_secs: number | null;
  language: string | null;
  status: string;
  has_diarization: boolean;
  diarization_error: string | null;
  error_class: string | null;
  error_message: string | null;
  retry_count: number;
  retry_max: number;
  transcribe_duration_secs: number | null;
  diarize_duration_secs: number | null;
  segment_count: number;
  speaker_count: number;
}

type SortKey = "published_at" | "status" | "duration_secs" | "processed_at" | "title";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "published_at", label: "Published" },
  { key: "status", label: "Status" },
  { key: "duration_secs", label: "Duration" },
  { key: "processed_at", label: "Processed" },
  { key: "title", label: "Title" },
];

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  transcribing: 1,
  diarizing: 2,
  archiving: 3,
  pending: 4,
  failed: 5,
  done: 6,
};

const PROCESSING_STEPS = ["downloading", "transcribing", "diarizing", "archiving"];

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(secs % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    downloading: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    transcribing: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    diarizing: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    archiving: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  };
  const label = status === "done" ? "Transcribed" : status.charAt(0).toUpperCase() + status.slice(1);
  const style = colors[status] ?? colors.pending;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${style}`}>{label}</span>
  );
}

function ErrorPill({ errorClass }: { errorClass: string }) {
  const isHard = errorClass === "DISK_FULL" || errorClass === "OOM";
  const color = isHard
    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  const label = errorClass.replace(/_/g, " ").toLowerCase();
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${color}`}>
      {label}
    </span>
  );
}

function ProcessingProgress({ status }: { status: string }) {
  const currentIdx = PROCESSING_STEPS.indexOf(status);
  if (currentIdx === -1) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
      {PROCESSING_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/50">→</span>}
          <span
            className={
              i < currentIdx
                ? "text-green-600 dark:text-green-400"
                : i === currentIdx
                ? "text-blue-600 dark:text-blue-400 font-medium animate-pulse"
                : "text-muted-foreground/40"
            }
          >
            {i < currentIdx ? "✓" : i === currentIdx ? "◉" : "○"}{" "}
            {step.charAt(0).toUpperCase() + step.slice(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatsBar({ episodes }: { episodes: EnrichedEpisode[] }) {
  const counts = useMemo(() => {
    const c = { total: episodes.length, done: 0, processing: 0, failed: 0, pending: 0 };
    for (const ep of episodes) {
      if (ep.status === "done") c.done++;
      else if (ep.status === "failed") c.failed++;
      else if (ep.status === "pending") c.pending++;
      else c.processing++;
    }
    return c;
  }, [episodes]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{counts.total} episodes</span>
      <span className="text-muted-foreground/50">·</span>
      <span>{counts.done} transcribed</span>
      {counts.processing > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-blue-600 dark:text-blue-400">{counts.processing} processing</span>
        </>
      )}
      {counts.failed > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-red-600 dark:text-red-400">{counts.failed} failed</span>
        </>
      )}
      {counts.pending > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span>{counts.pending} pending</span>
        </>
      )}
    </div>
  );
}

const STORAGE_KEY = "podlog-episodes-sort";

interface Props {
  episodes: EnrichedEpisode[];
  feedId: string;
}

export default function EpisodesList({ episodes, feedId }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  // Load sort preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { key, dir } = JSON.parse(stored);
        if (SORT_OPTIONS.some((o) => o.key === key)) setSortKey(key);
        if (dir === "asc" || dir === "desc") setSortDir(dir);
      }
    } catch {}
  }, []);

  // Persist sort preference
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch {}
  }, [sortKey, sortDir]);

  const sorted = useMemo(() => {
    const arr = [...episodes];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case "duration_secs":
          cmp = (a.duration_secs ?? 0) - (b.duration_secs ?? 0);
          break;
        case "processed_at": {
          const ta = a.processed_at ? new Date(a.processed_at).getTime() : 0;
          const tb = b.processed_at ? new Date(b.processed_at).getTime() : 0;
          cmp = ta - tb;
          break;
        }
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "published_at":
        default: {
          const pa = a.published_at ? new Date(a.published_at).getTime() : 0;
          const pb = b.published_at ? new Date(b.published_at).getTime() : 0;
          cmp = pa - pb;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [episodes, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // sensible defaults per sort key
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  function toggleError(id: string) {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRetry(episodeId: string) {
    setRetrying((prev) => new Set(prev).add(episodeId));
    try {
      await fetch(`/api/episodes/${episodeId}/retry`, { method: "POST" });
    } finally {
      // Keep retrying state — page will refresh on next navigation
    }
  }

  const isRetryable = (ep: EnrichedEpisode) =>
    ep.status === "failed" && ep.error_class !== "DISK_FULL" && ep.error_class !== "OOM";

  if (episodes.length === 0) {
    return <p className="text-muted-foreground">No episodes yet.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <StatsBar episodes={episodes} />

      {/* Sort controls */}
      <div className="flex flex-wrap items-center gap-2">
        <ArrowUpDown size={14} className="text-muted-foreground" />
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => toggleSort(opt.key)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              sortKey === opt.key
                ? "border-foreground/30 bg-accent text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            {opt.label}
            {sortKey === opt.key && (
              <span className="ml-1 inline-block">
                {sortDir === "asc" ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Episode cards */}
      <div className="space-y-2">
        {sorted.map((ep) => {
          const isProcessing = PROCESSING_STEPS.includes(ep.status);
          const isFailed = ep.status === "failed";

          return (
            <div
              key={ep.id}
              className={`border rounded-lg p-3 transition-colors ${
                isFailed
                  ? "border-red-200 dark:border-red-800"
                  : "border-border hover:bg-accent/30"
              }`}
            >
              <Link href={`/episodes/${ep.id}`} className="block">
                {/* Top row: title + status */}
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium truncate flex-1">
                    {ep.title ?? "Untitled"}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {!ep.has_diarization && ep.status === "done" && (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                        title="Speaker labels unavailable"
                      >
                        <AlertTriangle size={11} />
                        No labels
                      </span>
                    )}
                    <StatusBadge status={ep.status} />
                  </div>
                </div>

                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                  {ep.published_at && (
                    <span>{new Date(ep.published_at).toLocaleDateString()}</span>
                  )}
                  {ep.duration_secs != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      {formatDuration(ep.duration_secs)}
                    </span>
                  )}
                  {ep.language && (
                    <span className="inline-flex items-center gap-1">
                      <Globe size={11} />
                      {ep.language}
                    </span>
                  )}
                </div>

                {/* Done: segment/speaker counts + processing times */}
                {ep.status === "done" && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                    {ep.segment_count > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={11} />
                        {ep.segment_count} segments
                      </span>
                    )}
                    {ep.has_diarization && ep.speaker_count > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} />
                        {ep.speaker_count} speakers
                      </span>
                    )}
                    {ep.transcribe_duration_secs != null && (
                      <span>Transcription: {formatDuration(ep.transcribe_duration_secs)}</span>
                    )}
                    {ep.diarize_duration_secs != null && ep.has_diarization && (
                      <span>Diarization: {formatDuration(ep.diarize_duration_secs)}</span>
                    )}
                  </div>
                )}

                {/* Description snippet */}
                {ep.description && ep.status === "done" && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {ep.description.replace(/<[^>]+>/g, "").slice(0, 120)}
                  </p>
                )}
              </Link>

              {/* Processing progress */}
              {isProcessing && <ProcessingProgress status={ep.status} />}

              {/* Failed episode details */}
              {isFailed && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    {ep.error_class && <ErrorPill errorClass={ep.error_class} />}
                    {ep.retry_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Attempt {ep.retry_count} of {ep.retry_max}
                      </span>
                    )}
                    {isRetryable(ep) && (
                      <button
                        onClick={() => handleRetry(ep.id)}
                        disabled={retrying.has(ep.id)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <RotateCcw size={11} className={retrying.has(ep.id) ? "animate-spin" : ""} />
                        {retrying.has(ep.id) ? "Retrying…" : "Retry"}
                      </button>
                    )}
                    {ep.error_message && (
                      <button
                        onClick={() => toggleError(ep.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {expandedErrors.has(ep.id) ? "Hide details" : "Show details"}
                      </button>
                    )}
                  </div>
                  {expandedErrors.has(ep.id) && ep.error_message && (
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">
                      {ep.error_message}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
