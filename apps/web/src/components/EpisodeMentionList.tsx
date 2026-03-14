"use client";

import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import path from "path";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { formatTimestamp } from "@/lib/timestamp";
import type { EpisodeMentions } from "@/lib/search";

interface Props {
  query: string;
  episodeId: string;
  episodeTitle: string;
  audioLocalPath: string | null;
  feedTitle: string;
}

export default function EpisodeMentionList({
  query,
  episodeId,
  episodeTitle,
  audioLocalPath,
  feedTitle,
}: Props) {
  const { playEpisode } = useAudioPlayer();

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

  function handlePlay(startTime: number) {
    if (!audioLocalPath) return;
    const safeName = path.basename(audioLocalPath);
    playEpisode(episodeId, safeName, startTime, episodeTitle, feedTitle);
  }

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.mentions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No mentions found.</p>
    );
  }

  return (
    <div className="space-y-1.5 py-2">
      {data.mentions.map((mention) => (
        <div
          key={mention.id}
          className="flex items-start gap-3 rounded px-3 py-2 text-sm hover:bg-accent/30 transition-colors"
        >
          <span className="shrink-0 font-mono text-xs text-muted-foreground pt-0.5 w-14 text-right">
            {formatTimestamp(mention.startTime)}
          </span>

          <div className="min-w-0 flex-1">
            {mention.speakerDisplay && (
              <span className="font-medium text-foreground mr-1.5">
                {mention.speakerDisplay}:
              </span>
            )}
            <span
              className="text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground"
              dangerouslySetInnerHTML={{ __html: mention.snippet }}
            />
          </div>

          {audioLocalPath && (
            <button
              onClick={() => handlePlay(mention.startTime)}
              className="shrink-0 inline-flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 transition-opacity"
            >
              <Play size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
