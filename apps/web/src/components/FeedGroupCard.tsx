"use client";

import { useState } from "react";
import { ChevronRight, Radio, FileText } from "lucide-react";
import EpisodeMentionList from "@/components/EpisodeMentionList";
import type { FeedGroup } from "@/lib/search";

interface Props {
  feed: FeedGroup;
  query: string;
}

export default function FeedGroupCard({ feed, query }: Props) {
  const [expandedFeed, setExpandedFeed] = useState(true);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(
    new Set()
  );

  function toggleEpisode(episodeId: string) {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) {
        next.delete(episodeId);
      } else {
        next.add(episodeId);
      }
      return next;
    });
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Feed header */}
      <button
        onClick={() => setExpandedFeed((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
      >
        <ChevronRight
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${
            expandedFeed ? "rotate-90" : ""
          }`}
        />
        <Radio size={16} className="shrink-0 text-primary" />
        <span className="font-medium truncate flex-1">{feed.feedTitle}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {feed.mentionCount} mention{feed.mentionCount !== 1 ? "s" : ""} in{" "}
          {feed.episodes.length} episode{feed.episodes.length !== 1 ? "s" : ""}
        </span>
      </button>

      {/* Episode list */}
      {expandedFeed && (
        <div className="border-t border-border">
          {feed.episodes.map((episode) => {
            const isExpanded = expandedEpisodes.has(episode.episodeId);

            return (
              <div key={episode.episodeId} className="border-b border-border last:border-b-0">
                {/* Episode row */}
                <button
                  onClick={() => toggleEpisode(episode.episodeId)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 pl-11 hover:bg-accent/30 transition-colors text-left"
                >
                  <ChevronRight
                    size={14}
                    className={`shrink-0 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                  <FileText size={14} className="shrink-0 text-muted-foreground" />
                  <span className="text-sm truncate flex-1">
                    {episode.episodeTitle}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {episode.mentionCount} mention
                    {episode.mentionCount !== 1 ? "s" : ""}
                  </span>
                </button>

                {/* Expanded mentions */}
                {isExpanded && (
                  <div className="pl-16 pr-4 pb-2">
                    <EpisodeMentionList
                      query={query}
                      episodeId={episode.episodeId}
                      episodeTitle={episode.episodeTitle}
                      audioUrl={episode.audioUrl}
                      audioLocalPath={episode.audioLocalPath}
                      episodeUrl={episode.episodeUrl}
                      feedTitle={feed.feedTitle}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
