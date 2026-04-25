"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  activeSpeaker?: string | null;
}


export default function TranscriptView({
  episodeId,
  hasDiarization,
  status,
  segments: allSegments,
  audioLocalPath,
  episodeTitle,
  feedTitle,
  activeSpeaker,
}: Props) {
  const segments = activeSpeaker
    ? allSegments.filter((s) => s.speaker_label === activeSpeaker)
    : allSegments;
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { playEpisode } = useAudioPlayer();
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledToHashRef = useRef(false);

  /**
   * Find the segment element closest to a given time (in seconds) and
   * scroll to it with a highlight flash. Returns the element ID or null.
   */
  const scrollToTime = useCallback(
    (targetSecs: number) => {
      if (segments.length === 0) return null;

      // Find the segment whose start_time is closest to (but <= ) targetSecs,
      // falling back to the first segment after targetSecs.
      let bestSeg = segments[0];
      for (const seg of segments) {
        if (seg.start_time <= targetSecs) {
          bestSeg = seg;
        } else {
          break;
        }
      }

      const segId = `t-${Math.floor(bestSeg.start_time)}`;
      const el = document.getElementById(segId);
      if (el) {
        setHighlightedId(segId);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Clear highlight after a few seconds
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightedId(null), 4000);
      }
      return segId;
    },
    [segments],
  );

  // Handle initial hash navigation (from search results or direct links).
  // Guard with a ref so speaker-filter re-renders don't re-trigger the scroll.
  useEffect(() => {
    if (hasScrolledToHashRef.current) return;
    const hash = window.location.hash;
    if (hash.startsWith("#t-")) {
      const targetSecs = parseInt(hash.slice(3), 10);
      if (!isNaN(targetSecs)) {
        // Small delay to ensure DOM is rendered
        requestAnimationFrame(() => scrollToTime(targetSecs));
        hasScrolledToHashRef.current = true;
      }
    }
  }, [segments, scrollToTime]);

  // Listen for custom scroll-to-time events (from EpisodeDescription timestamp clicks)
  useEffect(() => {
    function handleScrollEvent(e: Event) {
      const detail = (e as CustomEvent<{ secs: number }>).detail;
      if (detail?.secs != null) {
        scrollToTime(detail.secs);
      }
    }
    window.addEventListener("podlog:scroll-to-time", handleScrollEvent);
    return () => window.removeEventListener("podlog:scroll-to-time", handleScrollEvent);
  }, [scrollToTime]);

  function handleTimestampClick(startTime: number) {
    const filename = audioLocalPath ? (audioLocalPath.split("/").pop() ?? null) : null;
    playEpisode(episodeId, filename, startTime, episodeTitle ?? undefined, feedTitle ?? undefined);
  }

  if (segments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {status === "done" ? "No transcript segments found." : `Processing... (${status})`}
      </p>
    );
  }

  // Group consecutive segments by speaker for cohesive rendering
  const groups: { speaker: string | null; displayName: string; segments: typeof segments; startIndex: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prevSpeaker = i > 0 ? segments[i - 1].speaker_label : null;
    if (i === 0 || seg.speaker_label !== prevSpeaker) {
      groups.push({
        speaker: seg.speaker_label,
        displayName: seg.display_name ?? seg.speaker_label ?? "",
        segments: [seg],
        startIndex: i,
      });
    } else {
      groups[groups.length - 1].segments.push(seg);
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const firstSeg = group.segments[0];
        const groupId = `t-${Math.floor(firstSeg.start_time)}`;
        const hasSpeaker = hasDiarization && group.speaker;

        if (!hasSpeaker) {
          // No diarization — plain lines with timestamps
          return (
            <div key={firstSeg.id} className="space-y-1">
              {group.segments.map((seg) => {
                const segId = `t-${Math.floor(seg.start_time)}`;
                const isHighlighted = segId === highlightedId;
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
              })}
            </div>
          );
        }

        const color = getSpeakerColor(group.speaker!);
        const initials = getSpeakerInitials(group.displayName, group.speaker!);

        return (
          <div key={firstSeg.id} id={groupId} className="flex gap-3">
            {/* Avatar */}
            <span
              className="shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5"
              style={{ background: color.hex, width: 32, height: 32 }}
            >
              {initials}
            </span>
            <div className="flex-1 min-w-0">
              {/* Speaker name + first timestamp */}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold" style={{ color: color.hex }}>
                  {group.displayName}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-primary font-mono transition-colors"
                  title="Play from here"
                  onClick={() => handleTimestampClick(firstSeg.start_time)}
                  disabled={!audioLocalPath}
                >
                  {formatTimestamp(firstSeg.start_time)}
                </button>
              </div>
              {/* Speech bubble with per-sentence timestamps */}
              <div
                className="rounded-b-xl rounded-tr-xl px-3 py-2 space-y-1.5"
                style={{ background: color.bg }}
              >
                {group.segments.map((seg, j) => {
                  const segId = `t-${Math.floor(seg.start_time)}`;
                  const isHighlighted = segId === highlightedId;
                  return (
                    <div
                      key={seg.id}
                      id={segId}
                      className={`flex gap-2 rounded-md -mx-1 px-1 ${isHighlighted ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}
                    >
                      {j > 0 ? (
                        <button
                          className="text-[11px] text-muted-foreground/50 hover:text-primary font-mono shrink-0 pt-0.5 w-11 text-right transition-colors"
                          title="Play from here"
                          onClick={() => handleTimestampClick(seg.start_time)}
                          disabled={!audioLocalPath}
                        >
                          {formatTimestamp(seg.start_time)}
                        </button>
                      ) : (
                        <div className="shrink-0 w-11" />
                      )}
                      <p className="text-sm leading-relaxed flex-1">{seg.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
