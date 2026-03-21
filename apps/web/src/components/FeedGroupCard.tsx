"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import EpisodeMentionList from "@/components/EpisodeMentionList";
import type { FeedGroup } from "@/lib/search";

interface Props {
  feed: FeedGroup;
  query: string;
}

/**
 * Episode-centric search result cards grouped under a feed header.
 * Episodes expand to show mentions with dialogue context.
 */
export default function FeedGroupCard({ feed, query }: Props) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(
    new Set()
  );
  const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";

  function toggleEpisode(episodeId: string) {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Feed header — minimal, not collapsible */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {feed.feedTitle}
        </span>
        {feed.feedMode === "test" && (
          <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0">
            <FlaskConical size={9} />
            Test
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {feed.mentionCount} mention{feed.mentionCount !== 1 ? "s" : ""} in{" "}
          {feed.episodes.length} episode{feed.episodes.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Episode cards */}
      {feed.episodes.map((episode) => {
        const isExpanded = expandedEpisodes.has(episode.episodeId);

        return (
          <Card key={episode.episodeId} className="overflow-hidden">
            <div className="flex items-center gap-0 hover:bg-accent/30 transition-colors">
              <button
                onClick={() => toggleEpisode(episode.episodeId)}
                className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0 text-left"
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
                <span className="text-sm font-medium truncate flex-1">
                  {episode.episodeTitle}
                </span>
              </button>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums bg-muted/50 px-2 py-0.5 rounded">
                {episode.mentionCount}
              </span>
              <Link
                href={`/episodes/${episode.episodeId}${queryParam}`}
                title="Go to episode"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground px-3 py-3 shrink-0 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={13} />
              </Link>
            </div>

            {isExpanded && (
              <div className="px-4 pb-3 border-t border-border">
                <EpisodeMentionList
                  query={query}
                  episodeId={episode.episodeId}
                  episodeTitle={episode.episodeTitle}
                  audioLocalPath={episode.audioLocalPath}
                  feedTitle={feed.feedTitle}
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
