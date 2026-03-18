"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Radio, FileText, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";

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
    <Card className="overflow-hidden">
      {/* Feed header */}
      <button
        onClick={() => setExpandedFeed((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
      >
        <ChevronRight
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
            expandedFeed ? "rotate-90" : ""
          }`}
        />
        <Radio size={16} className="shrink-0 text-primary" />
        <span className="font-medium truncate flex-1">{feed.feedTitle}</span>
        {feed.feedMode === "test" && (
          <Badge variant="outline" className="shrink-0 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0">
            <FlaskConical size={9} />
            Test
          </Badge>
        )}
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
                <div className="flex items-center gap-0 pl-11 hover:bg-accent/30 transition-colors">
                  <button
                    onClick={() => toggleEpisode(episode.episodeId)}
                    className="flex items-center gap-3 px-4 py-2.5 pl-0 flex-1 min-w-0 text-left"
                  >
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <FileText size={14} className="shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate flex-1">
                      {episode.episodeTitle}
                    </span>
                  </button>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {episode.mentionCount} mention
                    {episode.mentionCount !== 1 ? "s" : ""}
                  </span>
                  <Link
                    href={`/episodes/${episode.episodeId}${queryParam}`}
                    title="Go to episode"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-3 py-2.5 shrink-0 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={12} />
                  </Link>
                </div>

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
    </Card>
  );
}
