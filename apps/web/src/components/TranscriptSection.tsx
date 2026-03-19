"use client";

import { useState } from "react";
import SpeakerPanel from "@/components/SpeakerPanel";
import TranscriptView from "@/components/TranscriptView";
import TranscriptExportButton from "@/components/TranscriptExportButton";
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

  function handleRenamed(speakerLabel: string, newName: string) {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.speaker_label === speakerLabel
          ? { ...seg, display_name: newName, inferred: false, confirmed_by_user: true }
          : seg
      )
    );
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
      />
    </div>
  );
}
