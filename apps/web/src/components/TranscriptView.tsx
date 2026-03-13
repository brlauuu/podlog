"use client";

import { useState } from "react";
import SpeakerLabel from "@/components/SpeakerLabel";

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

interface Props {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Client-side transcript view with inline speaker renaming and inference badges (PRD-04 §8.1).
 */
export default function TranscriptView({ episodeId, hasDiarization, status, segments: initial }: Props) {
  const [segments, setSegments] = useState(initial);

  function handleRenamed(speakerLabel: string, newName: string) {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.speaker_label === speakerLabel
          ? { ...seg, display_name: newName, inferred: false, confirmed_by_user: true }
          : seg
      )
    );
  }

  if (segments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {status === "done" ? "No transcript segments found." : `Processing... (${status})`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((seg) => (
        <div key={seg.id} className="flex gap-3 group">
          <span className="text-xs text-muted-foreground font-mono shrink-0 mt-0.5 w-14 text-right">
            {formatTime(seg.start_time)}
          </span>
          <div className="flex-1 min-w-0">
            {hasDiarization && seg.speaker_label && (
              <div className="mb-0.5 flex items-center gap-1.5">
                <SpeakerLabel
                  episodeId={episodeId}
                  speakerLabel={seg.speaker_label}
                  displayName={seg.display_name ?? seg.speaker_label}
                  onRenamed={(newName) => handleRenamed(seg.speaker_label!, newName)}
                />
                {/* PRD-04 §8.1: inference badges */}
                {seg.inferred && !seg.confirmed_by_user && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300"
                    title="This name was inferred from the episode description. Click the edit icon to confirm or change it."
                  >
                    Inferred
                  </span>
                )}
                {seg.confirmed_by_user && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                    title="Speaker name confirmed by user"
                  >
                    &#10003; Confirmed
                  </span>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed">{seg.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
