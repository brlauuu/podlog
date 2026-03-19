"use client";

import { useState, useEffect } from "react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { getSpeakerColor, getSpeakerInitials } from "@/lib/speakerColors";
import type { Segment } from "@/lib/types";
import { formatTimestamp } from "@/lib/timestamp";

interface Props {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
}


export default function TranscriptView({
  episodeId,
  hasDiarization,
  status,
  segments,
  audioLocalPath,
  episodeTitle,
  feedTitle,
}: Props) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { playEpisode } = useAudioPlayer();

  useEffect(() => {
    if (highlightedId) return;
    const hash = window.location.hash;
    if (hash.startsWith("#t-")) {
      const targetId = hash.slice(1);
      const el = document.getElementById(targetId);
      if (el) {
        setHighlightedId(targetId);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [segments, highlightedId]);

  function handleTimestampClick(startTime: number) {
    if (!audioLocalPath) return;
    const filename = audioLocalPath.split("/").pop() ?? "";
    playEpisode(episodeId, filename, startTime, episodeTitle ?? undefined, feedTitle ?? undefined);
  }

  if (segments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {status === "done" ? "No transcript segments found." : `Processing... (${status})`}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        const segId = `t-${Math.floor(seg.start_time)}`;
        const isHighlighted = segId === highlightedId;
        const prevSpeaker = i > 0 ? segments[i - 1].speaker_label : null;
        const isSpeakerChange = seg.speaker_label !== prevSpeaker;
        const hasSpeaker = hasDiarization && seg.speaker_label;

        if (!hasSpeaker) {
          // No diarization — plain text with timestamp
          return (
            <div
              key={seg.id}
              id={segId}
              className={`flex gap-3 rounded-md py-1 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
            >
              <button
                className="text-xs text-muted-foreground hover:text-primary font-mono shrink-0 mt-0.5 w-14 text-right transition-colors"
                title="Play from here"
                onClick={() => handleTimestampClick(seg.start_time)}
                disabled={!audioLocalPath}
              >
                {formatTimestamp(seg.start_time)}
              </button>
              <p className="text-sm leading-relaxed flex-1">{seg.text}</p>
            </div>
          );
        }

        const color = getSpeakerColor(seg.speaker_label!);
        const displayName = seg.display_name ?? seg.speaker_label!;
        const initials = getSpeakerInitials(displayName, seg.speaker_label!);

        if (isSpeakerChange) {
          // Speaker change — show avatar + name + bubble
          return (
            <div
              key={seg.id}
              id={segId}
              className={`flex gap-3 mt-4 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
            >
              <span
                className="shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5"
                style={{ background: color.hex, width: 32, height: 32 }}
              >
                {initials}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold" style={{ color: color.hex }}>
                    {displayName}
                  </span>
                  <button
                    className="text-xs text-muted-foreground hover:text-primary font-mono transition-colors"
                    title="Play from here"
                    onClick={() => handleTimestampClick(seg.start_time)}
                    disabled={!audioLocalPath}
                  >
                    {formatTimestamp(seg.start_time)}
                  </button>
                </div>
                <div
                  className="text-sm leading-relaxed rounded-b-xl rounded-tr-xl px-3 py-2"
                  style={{ background: color.bg }}
                >
                  {seg.text}
                </div>
              </div>
            </div>
          );
        }

        // Consecutive segment — same speaker, smaller bubble
        return (
          <div
            key={seg.id}
            id={segId}
            className={`flex gap-3 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
          >
            {/* Spacer to align with avatar column */}
            <div className="shrink-0" style={{ width: 32 }} />
            <div className="flex-1 min-w-0">
              <div
                className="text-sm leading-relaxed rounded-xl px-3 py-2"
                style={{ background: color.bg }}
              >
                <button
                  className="text-xs text-muted-foreground hover:text-primary font-mono mr-2 transition-colors"
                  title="Play from here"
                  onClick={() => handleTimestampClick(seg.start_time)}
                  disabled={!audioLocalPath}
                >
                  {formatTimestamp(seg.start_time)}
                </button>
                {seg.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
