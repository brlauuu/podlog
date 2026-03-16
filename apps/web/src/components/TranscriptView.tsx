"use client";

import { useState, useEffect } from "react";
import SpeakerLabel from "@/components/SpeakerLabel";
import { Badge } from "@/components/ui/badge";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import path from "path";

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
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
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
export default function TranscriptView({ episodeId, hasDiarization, status, segments: initial, audioLocalPath, episodeTitle, feedTitle }: Props) {
  const [segments, setSegments] = useState(initial);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { playEpisode } = useAudioPlayer();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#t-")) {
      const targetId = hash.slice(1);
      const el = document.getElementById(targetId);
      if (el) {
        setHighlightedId(targetId);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

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
      {segments.map((seg) => {
        const segId = `t-${Math.floor(seg.start_time)}`;
        const isHighlighted = segId === highlightedId;
        return (
        <div
          key={seg.id}
          id={segId}
          className={`flex gap-3 group rounded-md transition-colors ${
            isHighlighted
              ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2"
              : ""
          }`}
        >
          <button
            className="text-xs text-muted-foreground hover:text-primary font-mono shrink-0 mt-0.5 w-14 text-right transition-colors"
            title="Play from here"
            onClick={() => {
              if (audioLocalPath) {
                const filename = path.basename(audioLocalPath);
                playEpisode(episodeId, filename, seg.start_time, episodeTitle ?? undefined, feedTitle ?? undefined);
              }
            }}
            disabled={!audioLocalPath}
          >
            {formatTime(seg.start_time)}
          </button>
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
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
                    title="This name was inferred from the episode description. Click the edit icon to confirm or change it."
                  >
                    Inferred
                  </Badge>
                )}
                {seg.confirmed_by_user && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                    title="Speaker name confirmed by user"
                  >
                    &#10003; Confirmed
                  </Badge>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">{seg.text}</p>
          </div>
        </div>
        );
      })}
    </div>
  );
}
