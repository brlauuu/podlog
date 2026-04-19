"use client";

import { Plus, RefreshCw, Trash2, FlaskConical, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface FeedCardFeed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
  last_polled_at: string | null;
  episode_count: number;
}

interface FeedCardProps {
  feed: FeedCardFeed;
  pollPending: boolean;
  onPromote: (url: string) => void;
  onPoll: (feedId: string) => void;
  onDelete: (feedId: string) => void;
  onAddMore?: (feed: FeedCardFeed) => void;
}

export default function FeedCard({
  feed,
  pollPending,
  onPromote,
  onPoll,
  onDelete,
  onAddMore,
}: FeedCardProps) {
  return (
    <Card className="hover:bg-accent/30 transition-colors">
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{feed.title ?? feed.url}</p>
            {feed.mode === "test" && (
              <Badge variant="outline" className="shrink-0 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-1">
                <FlaskConical size={10} />
                Test
              </Badge>
            )}
            {feed.mode === "selective" && (
              <Badge variant="outline" className="shrink-0 text-sky-700 border-sky-300 dark:text-sky-300 dark:border-sky-700 gap-1">
                <ListChecks size={10} />
                Selective
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{feed.url}</p>
          <p className="text-xs text-muted-foreground">
            {feed.episode_count} episodes ·{" "}
            {feed.last_polled_at
              ? `Last polled ${new Date(feed.last_polled_at).toLocaleString()}`
              : "Never polled"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {feed.mode === "selective" && onAddMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddMore(feed)}
              className="h-8 text-xs gap-1"
              title="Add more episodes from this feed"
            >
              <Plus size={12} />
              Add episodes
            </Button>
          )}
          {(feed.mode === "test" || feed.mode === "selective") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPromote(feed.url)}
              className="h-8 text-xs"
            >
              Promote to Full
            </Button>
          )}
          {feed.mode !== "selective" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPoll(feed.id)}
              disabled={pollPending}
              title="Poll now"
              className="h-8 w-8"
            >
              <RefreshCw size={14} className={pollPending ? "animate-spin" : ""} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(feed.id)}
            title="Remove feed"
            className="h-8 w-8 hover:text-destructive"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
