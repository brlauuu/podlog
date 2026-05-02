"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import ReprocessButton from "./ReprocessButton";
import { formatDate } from "@/lib/dateFormat";
import { formatFileSize } from "@/lib/formatFileSize";

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
  pyannote_cloud_cost_usd: number | null;
  audio_file_size_bytes: number | null;
  speaker_count: number;
  speaker_name_tags: SpeakerNameTag[];
}

export const PROCESSING_STEPS = ["downloading", "transcribing", "diarizing", "archiving"];

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
  return <span className={`${CHIP_BASE_CLASS} ${className ?? ""}`}>{children}</span>;
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
  return <Tag className={`capitalize ${color}`}>{label}</Tag>;
}

function PyannoteCloudCostTag({ costUsd }: { costUsd: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const label = costUsd > 0 ? `$${costUsd.toFixed(2)}` : "—";

  return (
    <div
      className="relative inline-flex items-center pointer-events-auto"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Tag className="bg-muted text-muted-foreground cursor-default">
        pyannote cloud: {label}
      </Tag>
      {showTooltip && (
        <div className="absolute z-50 bottom-full mb-1 left-1/2 -translate-x-1/2 w-64 p-2 rounded-md bg-card text-card-foreground text-xs shadow-md border">
          <div className="font-medium mb-1">pyannote cloud (Precision-2)</div>
          {costUsd > 0 ? (
            <div>Estimated cost: ${costUsd.toFixed(4)}</div>
          ) : (
            <div>
              Cost estimate unavailable — set your per-second rate in
              Settings &gt; Remote Inference to show an estimate here. Actual
              billing is on your pyannote.ai dashboard.
            </div>
          )}
          <div className="mt-1 text-muted-foreground">
            Billed in seconds with a 20-second per-request minimum.
          </div>
        </div>
      )}
    </div>
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
        <div className="absolute z-50 bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 p-2 rounded-md bg-card text-card-foreground text-xs shadow-md border">
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

interface EpisodeCardProps {
  episode: EnrichedEpisode;
  expandedError: boolean;
  onToggleError: (e: React.MouseEvent, id: string) => void;
  onDelete?: (episode: EnrichedEpisode) => Promise<void> | void;
  deleting?: boolean;
}

export default function EpisodeCard({
  episode: ep,
  expandedError,
  onToggleError,
  onDelete,
  deleting,
}: EpisodeCardProps) {
  const isProcessing = PROCESSING_STEPS.includes(ep.status);
  const isFailed = ep.status === "failed";
  const lang = ep.language?.toLowerCase() ?? "";
  const flag = LANGUAGE_FLAGS[lang];
  const hasSpeakerNames = ep.speaker_name_tags?.length > 0;

  async function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete) return;
    await onDelete(ep);
  }

  return (
    <div
      className={`relative border rounded-lg p-3 transition-colors ${
        isFailed ? "border-red-200 dark:border-red-800" : "border-border hover:bg-accent/30"
      } ${onDelete ? "pb-9" : ""}`}
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
            {formatDate(ep.published_at)}
          </Tag>
        )}

        {ep.duration_secs != null && (
          <Tag className="bg-muted text-muted-foreground">
            {formatDuration(ep.duration_secs)}
          </Tag>
        )}

        {ep.audio_file_size_bytes != null && (
          <Tag className="bg-muted text-muted-foreground">
            {formatFileSize(ep.audio_file_size_bytes)}
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

        {ep.pyannote_cloud_cost_usd != null && (
          <PyannoteCloudCostTag costUsd={ep.pyannote_cloud_cost_usd} />
        )}

        {/* Reprocess button - last item in tag row */}
        <span className="relative z-10 pointer-events-auto">
          <ReprocessButton episodeId={ep.id} />
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
                onClick={(e) => onToggleError(e, ep.id)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {expandedError ? "Hide details" : "Show details"}
              </button>
            )}
          </div>
          {expandedError && ep.error_message && (
            <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap break-words overflow-y-auto max-h-32">
              {ep.error_message}
            </pre>
          )}
        </div>
      )}

      {/* Delete button — bottom right */}
      {onDelete && (
        <button
          type="button"
          aria-label="Delete upload"
          onClick={handleDeleteClick}
          disabled={deleting}
          className="absolute bottom-2 right-2 z-10 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      )}
    </div>
  );
}
