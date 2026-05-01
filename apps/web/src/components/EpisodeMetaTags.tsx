"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  XCircle,
} from "lucide-react";
import { formatTimestamp } from "@/lib/timestamp";
import { formatDate } from "@/lib/dateFormat";
import ReprocessButton from "@/components/ReprocessButton";

interface EpisodeMetaTagsProps {
  status: string;
  publishedAt: string | null;
  durationSecs: number | null;
  language: string | null;
  hasDiarization: boolean;
  transcribeDurationSecs: number | null;
  diarizeDurationSecs: number | null;
  diarizeStepDurations: Record<string, number> | null;
  inferenceProviderUsed: string | null;
  fireworksSttCostUsd: number | null;
  fireworksAudioMinutes: number | null;
  pyannoteCloudCostUsd: number | null;
  episodeId: string;
}

// Issue #609: keep visual parity with EpisodeCard's tag strip. Mirrors the
// LANGUAGE_FLAGS map there; if a new language is added, update both. The two
// surfaces deliberately duplicate small tag helpers rather than share a
// component because the card uses a slightly different chip style.
const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇺🇸", de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸", pt: "🇧🇷",
  it: "🇮🇹", nl: "🇳🇱", ja: "🇯🇵", zh: "🇨🇳", ko: "🇰🇷",
  ru: "🇷🇺", ar: "🇸🇦", pl: "🇵🇱", sv: "🇸🇪", da: "🇩🇰",
  fi: "🇫🇮", no: "🇳🇴", nb: "🇳🇴", cs: "🇨🇿", uk: "🇺🇦",
  tr: "🇹🇷", hu: "🇭🇺", ro: "🇷🇴", el: "🇬🇷", he: "🇮🇱",
  hi: "🇮🇳", id: "🇮🇩", vi: "🇻🇳", th: "🇹🇭", sr: "🇷🇸",
  hr: "🇭🇷", bg: "🇧🇬", sk: "🇸🇰", sl: "🇸🇮",
};

const STEP_ABBREVIATIONS: Record<string, string> = {
  io: "I/O", api: "API", stt: "STT", url: "URL",
};
const CHIP_BASE_CLASS = "inline-flex h-5 items-center rounded px-1.5 text-xs font-medium leading-none";

function formatDiarizeStepLabel(key: string): string {
  const words = key.replace(/_secs$/, "").split("_").filter(Boolean);
  if (!words.length) return key;
  const formatted = words.map(w => STEP_ABBREVIATIONS[w.toLowerCase()] ?? w.toLowerCase());
  const label = formatted.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`${CHIP_BASE_CLASS} ${className ?? "bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
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

function StatusTag({ status }: { status: string }) {
  const isFailed = status === "failed";
  const label = isFailed ? "Failed" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`${CHIP_BASE_CLASS} gap-1 border ${
        isFailed
          ? "text-red-700 border-red-300 dark:text-red-300 dark:border-red-700"
          : "text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-700"
      }`}
    >
      {isFailed ? <XCircle size={10} /> : <Loader2 size={10} className="animate-spin" />}
      {label}
    </span>
  );
}

function PyannoteCloudCostTag({ costUsd }: { costUsd: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const label = costUsd > 0 ? `$${costUsd.toFixed(2)}` : "—";

  return (
    <div
      className="relative inline-flex items-center"
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

function FireworksCostTag({
  costUsd,
  audioMinutes,
}: {
  costUsd: number;
  audioMinutes: number | null;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative inline-flex items-center"
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

export default function EpisodeMetaTags({
  status,
  publishedAt,
  durationSecs,
  language,
  hasDiarization,
  transcribeDurationSecs,
  diarizeDurationSecs,
  diarizeStepDurations,
  inferenceProviderUsed,
  fireworksSttCostUsd,
  fireworksAudioMinutes,
  pyannoteCloudCostUsd,
  episodeId,
}: EpisodeMetaTagsProps) {
  const [stepsExpanded, setStepsExpanded] = useState(false);

  const hasSteps =
    diarizeStepDurations != null && Object.keys(diarizeStepDurations).length > 0;

  const lang = language?.toLowerCase() ?? "";
  const flag = LANGUAGE_FLAGS[lang];

  return (
    <div className="space-y-2">
      {/* Row 1: informational tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {status !== "done" && <StatusTag status={status} />}

        {/* Issue #609: parity with the episode card's tag strip. */}
        {!hasDiarization && status === "done" && (
          <Tag className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle size={10} />
            No labels
          </Tag>
        )}

        {publishedAt && (
          <Tag>{formatDate(publishedAt)}</Tag>
        )}

        {durationSecs != null && (
          <Tag>{formatTimestamp(durationSecs)}</Tag>
        )}

        {language && (
          <Tag>
            {flag ? `${flag} ` : ""}{language.toUpperCase()}
          </Tag>
        )}

        <ProviderTag provider={inferenceProviderUsed} />

        {transcribeDurationSecs != null && (
          <Tag>Transcribed: {formatTimestamp(transcribeDurationSecs)}</Tag>
        )}

        {diarizeDurationSecs != null && (
          <button
            onClick={() => setStepsExpanded(v => !v)}
            className={`${CHIP_BASE_CLASS} gap-0.5 bg-muted text-muted-foreground hover:bg-muted/80 transition-colors`}
            aria-label={`Diarized: ${formatTimestamp(diarizeDurationSecs)}`}
          >
            Diarized: {formatTimestamp(diarizeDurationSecs)}
            {hasSteps && (
              stepsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />
            )}
          </button>
        )}

        {inferenceProviderUsed === "fireworks" && fireworksSttCostUsd != null && (
          <FireworksCostTag
            costUsd={fireworksSttCostUsd}
            audioMinutes={fireworksAudioMinutes}
          />
        )}

        {pyannoteCloudCostUsd != null && (
          <PyannoteCloudCostTag costUsd={pyannoteCloudCostUsd} />
        )}
      </div>

      {/* Row 2: collapsible diarization step breakdown */}
      {stepsExpanded && hasSteps && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(diarizeStepDurations!).map(([step, secs]) => (
            <Tag key={step}>
              {formatDiarizeStepLabel(step)}: {formatTimestamp(secs)}
            </Tag>
          ))}
        </div>
      )}

      {/* Row 3: actions */}
      <div>
        <ReprocessButton episodeId={episodeId} />
      </div>
    </div>
  );
}
