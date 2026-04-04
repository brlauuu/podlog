"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Play } from "lucide-react";
import Link from "next/link";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { formatTimestamp } from "@/lib/timestamp";
import type { EpisodeMentions, ContextSegment, Mention } from "@/lib/search";
import { basename } from "@/lib/utils";

interface Props {
  query: string;
  episodeId: string;
  episodeTitle: string;
  audioLocalPath: string | null;
  feedTitle: string;
  /** How many mentions to show expanded initially */
  initialExpanded?: number;
}

function ContextLine({ seg, dimmed }: { seg: ContextSegment; dimmed: boolean }) {
  return (
    <div className={`flex gap-2 ${dimmed ? "opacity-50" : ""}`}>
      <span className="text-[11px] font-mono text-muted-foreground shrink-0 pt-0.5 w-12 text-right">
        {formatTimestamp(seg.startTime)}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {seg.speakerDisplay && (
          <span className="font-semibold text-foreground mr-1">
            {seg.speakerDisplay}:
          </span>
        )}
        <span className="text-muted-foreground">{seg.text}</span>
      </div>
    </div>
  );
}

const SNIPPET_COLLAPSE_THRESHOLD = 500;

function MentionCard({
  mention,
  index,
  total,
  episodeId,
  audioLocalPath,
  episodeTitle,
  feedTitle,
  query,
}: {
  mention: Mention;
  index: number;
  total: number;
  episodeId: string;
  audioLocalPath: string | null;
  episodeTitle: string;
  feedTitle: string;
  query: string;
}) {
  const { playEpisode } = useAudioPlayer();
  const [expanded, setExpanded] = useState(false);
  const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";
  const isLong = mention.snippet.length > SNIPPET_COLLAPSE_THRESHOLD;

  function handlePlay() {
    if (!audioLocalPath) return;
    playEpisode(episodeId, basename(audioLocalPath), mention.startTime, episodeTitle, feedTitle);
  }

  return (
    <div className="border border-border rounded-lg bg-background overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Mention {index + 1} of {total} &middot;{" "}
          <span className="font-mono text-primary">{formatTimestamp(mention.startTime)}</span>
        </span>
        <div className="flex items-center gap-2">
          {audioLocalPath && (
            <button
              onClick={handlePlay}
              className="inline-flex items-center gap-1 text-[11px] border border-border px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <Play size={10} /> Play
            </button>
          )}
          <Link
            href={`/episodes/${episodeId}${queryParam}#t-${Math.floor(mention.startTime)}`}
            className="inline-flex items-center gap-1 text-[11px] border border-border px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileText size={10} /> Episode
          </Link>
        </div>
      </div>

      {/* Dialogue context */}
      <div className="px-3 py-2.5 space-y-1.5">
        {/* Context before */}
        {mention.contextBefore.map((seg, i) => (
          <ContextLine key={`before-${i}`} seg={seg} dimmed />
        ))}

        {/* Matched turn (highlighted) */}
        <div className="flex gap-2 bg-yellow-50 dark:bg-yellow-950/30 rounded-md px-2 py-1.5 -mx-2">
          <span className="text-[11px] font-mono text-muted-foreground shrink-0 pt-0.5 w-12 text-right">
            {formatTimestamp(mention.startTime)}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-relaxed">
            {mention.speakerDisplay && (
              <span className="font-semibold text-foreground mr-1">
                {mention.speakerDisplay}:
              </span>
            )}
            <span
              className={`text-foreground [&_b]:font-semibold [&_b]:bg-yellow-200 [&_b]:dark:bg-yellow-800 [&_b]:px-0.5 [&_b]:rounded-sm ${
                isLong && !expanded ? "line-clamp-4" : ""
              }`}
              dangerouslySetInnerHTML={{ __html: mention.snippet }}
            />
            {isLong && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-primary hover:underline mt-1 block"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        </div>

        {/* Context after */}
        {mention.contextAfter.map((seg, i) => (
          <ContextLine key={`after-${i}`} seg={seg} dimmed />
        ))}
      </div>
    </div>
  );
}

export default function EpisodeMentionList({
  query,
  episodeId,
  episodeTitle,
  audioLocalPath,
  feedTitle,
  initialExpanded = 2,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery<EpisodeMentions>({
    queryKey: ["mentions", query, episodeId],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, episodeId });
      const resp = await fetch(`/api/search/mentions?${params}`);
      if (!resp.ok) throw new Error("Failed to load mentions");
      return resp.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.mentions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No mentions found.</p>
    );
  }

  const visibleMentions = showAll
    ? data.mentions
    : data.mentions.slice(0, initialExpanded);
  const hiddenCount = data.mentions.length - initialExpanded;

  return (
    <div className="space-y-3 py-2">
      {visibleMentions.map((mention, i) => (
        <MentionCard
          key={mention.id}
          mention={mention}
          index={i}
          total={data.mentions.length}
          episodeId={episodeId}
          audioLocalPath={audioLocalPath}
          episodeTitle={episodeTitle}
          feedTitle={feedTitle}
          query={query}
        />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-sm text-primary hover:underline w-full text-center py-1"
        >
          Show {hiddenCount} more mention{hiddenCount !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
