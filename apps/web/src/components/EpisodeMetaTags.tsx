"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  MicOff,
  XCircle,
} from "lucide-react";
import { formatTimestamp } from "@/lib/timestamp";
import { formatDate } from "@/lib/dateFormat";
import { formatFileSize } from "@/lib/formatFileSize";
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
  audioFileSizeBytes: number | null;
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

// Episodes transcribed through Fireworks before #1092 keep a small marker;
// everything since runs locally, so local needs no tag.
function RemoteProvenanceTag({ provider }: { provider: string | null }) {
  if (provider !== "fireworks") return null;
  return (
    <Tag className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
      Transcribed remotely
    </Tag>
  );
}

function StatusTag({ status }: { status: string }) {
  const isFailed = status === "failed";
  // #955: no_speech is terminal, not in-flight. Without this branch it would
  // render as "No_speech" next to a spinning loader, implying work still in
  // progress on an episode that has already finished.
  const isNoSpeech = status === "no_speech";
  const label = isFailed
    ? "Failed"
    : isNoSpeech
      ? "No speech"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`${CHIP_BASE_CLASS} gap-1 border ${
        isFailed
          ? "text-red-700 border-red-300 dark:text-red-300 dark:border-red-700"
          : isNoSpeech
            ? "text-muted-foreground border-border"
            : "text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-700"
      }`}
    >
      {isFailed ? (
        <XCircle size={10} />
      ) : isNoSpeech ? (
        <MicOff size={10} />
      ) : (
        <Loader2 size={10} className="animate-spin" />
      )}
      {label}
    </span>
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
  audioFileSizeBytes,
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

        {audioFileSizeBytes != null && (
          <Tag>{formatFileSize(audioFileSizeBytes)}</Tag>
        )}

        {language && (
          <Tag>
            {flag ? `${flag} ` : ""}{language.toUpperCase()}
          </Tag>
        )}

        <RemoteProvenanceTag provider={inferenceProviderUsed} />

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
