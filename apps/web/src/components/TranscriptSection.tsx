"use client";

import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import SpeakerPanel from "@/components/SpeakerPanel";
import TranscriptView from "@/components/TranscriptView";
import TranscriptExportButton from "@/components/TranscriptExportButton";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import type { Segment } from "@/lib/types";

interface Props {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
  publishedAt: string | null;
  durationSecs: number | null;
  description: string | null;
  feedUrl: string | null;
  feedWebsiteUrl: string | null;
  feedDescription: string | null;
  audioUrl: string | null;
  guid: string | null;
}

export default function TranscriptSection({
  episodeId,
  hasDiarization,
  status,
  segments: initial,
  audioLocalPath,
  episodeTitle,
  feedTitle,
  publishedAt,
  durationSecs,
  description,
  feedUrl,
  feedWebsiteUrl,
  feedDescription,
  audioUrl,
  guid,
}: Props) {
  const [segments, setSegments] = useState(initial);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const { state: playerState } = useAudioPlayer();
  const playerVisible = !!playerState.src;

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 400);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
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

  function handleMerged(sourceLabels: string[], targetLabel: string) {
    // If the active filter is one of the merged-away speakers, switch to target
    if (activeSpeaker && sourceLabels.includes(activeSpeaker)) {
      setActiveSpeaker(targetLabel);
    }
    setSegments((prev) => {
      // Copy the target speaker's display name to reassigned segments
      const targetSeg = prev.find(
        (s) => s.speaker_label === targetLabel && s.display_name
      );
      const targetDisplayName = targetSeg?.display_name ?? null;
      const targetInferred = targetSeg?.inferred ?? false;
      const targetConfirmed = targetSeg?.confirmed_by_user ?? false;

      return prev.map((seg) =>
        seg.speaker_label && sourceLabels.includes(seg.speaker_label)
          ? {
              ...seg,
              speaker_label: targetLabel,
              display_name: targetDisplayName,
              inferred: targetInferred,
              confirmed_by_user: targetConfirmed,
            }
          : seg
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
        {segments.length > 0 && (
          <TranscriptExportButton
            episodeTitle={episodeTitle ?? "Untitled Episode"}
            feedTitle={feedTitle}
            publishedAt={publishedAt}
            durationSecs={durationSecs}
            description={description}
            feedUrl={feedUrl}
            feedWebsiteUrl={feedWebsiteUrl}
            feedDescription={feedDescription}
            audioUrl={audioUrl}
            guid={guid}
            segments={segments}
          />
        )}
      </div>

      {hasDiarization && (
        <SpeakerPanel
          episodeId={episodeId}
          segments={segments}
          onRenamed={handleRenamed}
          onMerged={handleMerged}
          activeSpeaker={activeSpeaker}
          onFilterSpeaker={setActiveSpeaker}
        />
      )}

      <TranscriptView
        episodeId={episodeId}
        hasDiarization={hasDiarization}
        status={status}
        segments={segments}
        audioLocalPath={audioLocalPath}
        episodeTitle={episodeTitle}
        feedTitle={feedTitle}
        activeSpeaker={activeSpeaker}
      />

      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={`fixed right-6 z-[60] p-2.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all ${
            playerVisible ? "bottom-24" : "bottom-20"
          }`}
          title="Back to top"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
