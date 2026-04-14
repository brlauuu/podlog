"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";

import ReprocessButton from "./ReprocessButton";
import { Input } from "@/components/ui/input";

export interface SpeakerNameTag {
  display_name: string;
  inferred: boolean;
  confirmed_by_user: boolean;
}

export interface EnrichedEpisode {
  id: string;
  title: string | null;
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
  inference_provider_used: string | null;
  fireworks_audio_minutes: number | null;
  fireworks_stt_cost_usd: number | null;
  speaker_count: number;
  speaker_name_tags: SpeakerNameTag[];
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

// ISO 639-1 → flag emoji
const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇺🇸", de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸", pt: "🇧🇷",
  it: "🇮🇹", nl: "🇳🇱", ja: "🇯🇵", zh: "🇨🇳", ko: "🇰🇷",
  ru: "🇷🇺", ar: "🇸🇦", pl: "🇵🇱", sv: "🇸🇪", da: "🇩🇰",
  fi: "🇫🇮", no: "🇳🇴", nb: "🇳🇴", cs: "🇨🇿", uk: "🇺🇦",
  tr: "🇹🇷", hu: "🇭🇺", ro: "🇷🇴", el: "🇬🇷", he: "🇮🇱",
  hi: "🇮🇳", id: "🇮🇩", vi: "🇻🇳", th: "🇹🇭", sr: "🇷🇸",
  hr: "🇭🇷", bg: "🇧🇬", sk: "🇸🇰", sl: "🇸🇮",
};

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(secs % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const CHIP_BASE_CLASS = "inline-flex h-5 items-center rounded px-1.5 text-xs font-medium leading-none";

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`${CHIP_BASE_CLASS} ${className ?? ""}`}>
      {children}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
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
  return <Tag className={colors[status] ?? colors.pending}>{label}</Tag>;
}

function ProviderTag({ provider }: { provider: string | null }) {
  const isRemote = provider === "fireworks";
  return (
    <Tag
      className={
        isRemote
          ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200"
          : "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200"
      }
    >
      {isRemote ? "Remote inference" : "Local inference"}
    </Tag>
  );
}

function ErrorPill({ errorClass }: { errorClass: string }) {
  const isHard = errorClass === "DISK_FULL" || errorClass === "OOM";
  const color = isHard
    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  const label = errorClass.replace(/_/g, " ").toLowerCase();
  return (
    <Tag className={`capitalize ${color}`}>{label}</Tag>
  );
}

function FireworksCostTag({ costUsd, audioMinutes }: { costUsd: number; audioMinutes: number | null }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative inline-flex items-center pointer-events-auto"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Tag className="bg-muted text-muted-foreground cursor-default">
        Fireworks STT: ${costUsd.toFixed(2)}
      </Tag>
      {showTooltip && (
        <div className="absolute z-50 bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 p-2 rounded-md bg-popover text-popover-foreground text-xs shadow-md border">
          <div className="font-medium mb-1">Fireworks STT Details</div>
          {audioMinutes != null && <div>Audio: {audioMinutes.toFixed(1)} min</div>}
          <div>Cost: ${costUsd.toFixed(4)}</div>
          {audioMinutes != null && audioMinutes > 0 && (
            <div>Rate: ${(costUsd / audioMinutes).toFixed(4)}/min</div>
          )}
        </div>
      )}
    </div>
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

function StatsBar({
  episodes,
  filteredCount,
  searchQuery
}: {
  episodes: EnrichedEpisode[];
  filteredCount: number;
  searchQuery: string;
}) {
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
      {searchQuery ? (
        <span className="font-medium text-foreground">
          Showing {filteredCount} of {counts.total} episodes
        </span>
      ) : (
        <span className="font-medium text-foreground">{counts.total} episodes</span>
      )}
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
  const [searchQuery, setSearchQuery] = useState("");

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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch {}
  }, [sortKey, sortDir]);

  const filteredAndSorted = useMemo(() => {
    // First filter by search query
    const normalizedQuery = searchQuery.toLowerCase();
    const filtered = searchQuery
      ? episodes.filter((ep) =>
          ep.title?.toLowerCase().includes(normalizedQuery)
        )
      : episodes;

    // Then sort
    const arr = [...filtered];
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
  }, [episodes, sortKey, sortDir, searchQuery]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  function toggleError(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (episodes.length === 0) {
    return <p className="text-muted-foreground">No episodes yet.</p>;
  }

  return (
    <div className="space-y-4">
      <StatsBar episodes={episodes} filteredCount={filteredAndSorted.length} searchQuery={searchQuery} />

      {/* Search input */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search episodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
          aria-label="Search episodes by title"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

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

      <div className="space-y-2">
        {filteredAndSorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No episodes match your search
          </p>
        ) : (
          filteredAndSorted.map((ep) => {
          const isProcessing = PROCESSING_STEPS.includes(ep.status);
          const isFailed = ep.status === "failed";
          const lang = ep.language?.toLowerCase() ?? "";
          const flag = LANGUAGE_FLAGS[lang];
          const hasSpeakerNames = ep.speaker_name_tags?.length > 0;

          return (
            <div
              key={ep.id}
              className={`relative border rounded-lg p-3 transition-colors ${
                isFailed
                  ? "border-red-200 dark:border-red-800"
                  : "border-border hover:bg-accent/30"
              }`}
            >
              {/* Stretched link covers the entire card; interactive elements sit above it with z-10 */}
              <Link
                href={`/episodes/${ep.id}`}
                className="absolute inset-0 rounded-lg"
                aria-label={ep.title ?? "Episode"}
              />

              {/* Title */}
              <p className="text-base font-semibold leading-snug pr-2 relative z-10 pointer-events-none">
                {ep.title ?? "Untitled"}
              </p>

              {/* Tag strip — metadata row */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2 relative z-10 pointer-events-none">
                <StatusTag status={ep.status} />

                {!ep.has_diarization && ep.status === "done" && (
                  <Tag className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <AlertTriangle size={10} />
                    No labels
                  </Tag>
                )}

                {ep.published_at && (
                  <Tag className="bg-muted text-muted-foreground">
                    {new Date(ep.published_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </Tag>
                )}

                {ep.duration_secs != null && (
                  <Tag className="bg-muted text-muted-foreground">
                    {formatDuration(ep.duration_secs)}
                  </Tag>
                )}

                {ep.language && (
                  <Tag className="bg-muted text-muted-foreground">
                    {flag ? `${flag} ` : ""}{ep.language.toUpperCase()}
                  </Tag>
                )}

                <ProviderTag provider={ep.inference_provider_used} />

                {ep.status === "done" && ep.transcribe_duration_secs != null && ep.transcribe_duration_secs > 0 && (
                  <Tag className="bg-muted text-muted-foreground">
                    Transcribed: {formatDuration(ep.transcribe_duration_secs)}
                  </Tag>
                )}

                {ep.status === "done" && ep.diarize_duration_secs != null && ep.diarize_duration_secs > 0 && (
                  <Tag className="bg-muted text-muted-foreground">
                    Diarized: {formatDuration(ep.diarize_duration_secs)}
                  </Tag>
                )}

                {ep.inference_provider_used === "fireworks" && ep.fireworks_stt_cost_usd != null && (
                  <FireworksCostTag
                    costUsd={ep.fireworks_stt_cost_usd}
                    audioMinutes={ep.fireworks_audio_minutes}
                  />
                )}

                {/* Reprocess button - last item in tag row */}
                <span className="relative z-10 pointer-events-auto">
                  <ReprocessButton episodeId={ep.id} status={ep.status} />
                </span>
              </div>

              {/* Speaker name tags — row 2 (only when names are known) */}
              {hasSpeakerNames && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5 relative z-10 pointer-events-none">
                  {ep.speaker_name_tags.map((sn) => (
                    <Tag
                      key={sn.display_name}
                      className={
                        sn.confirmed_by_user
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                          : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                      }
                    >
                      {sn.display_name}
                    </Tag>
                  ))}
                </div>
              )}

              {/* Fallback: show speaker count when diarized but no named speakers */}
              {!hasSpeakerNames && ep.has_diarization && ep.speaker_count > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 relative z-10 pointer-events-none">
                  <Tag className="bg-muted text-muted-foreground">
                    {ep.speaker_count} speaker{ep.speaker_count !== 1 ? "s" : ""}
                  </Tag>
                </div>
              )}

              {/* Processing progress (in-flight) */}
              {isProcessing && (
                <div className="relative z-10 pointer-events-none">
                  <ProcessingProgress status={ep.status} />
                </div>
              )}

              {/* Failed episode details */}
              {isFailed && (
                <div className="mt-2 space-y-1 relative z-10">
                  <div className="flex items-center gap-2">
                    {ep.error_class && <ErrorPill errorClass={ep.error_class} />}
                    {ep.retry_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Attempt {ep.retry_count} of {ep.retry_max}
                      </span>
                    )}
                    {ep.error_message && (
                      <button
                        onClick={(e) => toggleError(e, ep.id)}
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
        }))}
      </div>
    </div>
  );
}
