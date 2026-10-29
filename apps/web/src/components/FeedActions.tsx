"use client";

/**
 * The per-feed action buttons. Split out of FeedCard in #1090 so the podcast
 * page offers the same actions, with the same mode rules, as /feeds.
 *
 * Renders the buttons only; the caller supplies the wrapping row. An action
 * whose callback is omitted is not rendered.
 */
import { Plus, RefreshCw, Trash2, ListChecks, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FeedActionsFeed {
  id: string;
  mode: string;
  paused: boolean;
}

interface FeedActionsProps {
  feed: FeedActionsFeed;
  pollPending?: boolean;
  pausePending?: boolean;
  convertPending?: boolean;
  onAddMore?: () => void;
  onPromote?: () => void;
  /** #1045: step a test/full feed down to selective. */
  onConvertToSelective?: () => void;
  onPoll?: () => void;
  onTogglePause?: () => void;
  onDelete?: () => void;
}

export default function FeedActions({
  feed,
  pollPending = false,
  pausePending = false,
  convertPending = false,
  onAddMore,
  onPromote,
  onConvertToSelective,
  onPoll,
  onTogglePause,
  onDelete,
}: FeedActionsProps) {
  return (
    <>
      {feed.mode === "selective" && onAddMore && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAddMore}
          className="h-8 text-xs gap-1"
          title="Add more episodes from this feed"
        >
          <Plus size={12} />
          Add episodes
        </Button>
      )}
      {(feed.mode === "test" || feed.mode === "selective") && onPromote && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPromote}
          className="h-8 text-xs"
        >
          Promote to Full
        </Button>
      )}
      {feed.mode !== "selective" && onConvertToSelective && (
        <Button
          variant="outline"
          size="sm"
          onClick={onConvertToSelective}
          disabled={convertPending}
          className="h-8 text-xs gap-1"
          data-testid={`selective-${feed.id}`}
          title="Stop ingesting new episodes automatically; pick them by hand instead"
        >
          <ListChecks size={12} />
          Make selective
        </Button>
      )}
      {feed.mode !== "selective" && onPoll && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onPoll}
          disabled={pollPending || feed.paused}
          title={feed.paused ? "Unpause to poll" : "Poll now"}
          className="h-8 w-8"
        >
          <RefreshCw size={14} className={pollPending ? "animate-spin" : ""} />
        </Button>
      )}
      {feed.mode !== "selective" && onTogglePause && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePause}
          disabled={pausePending}
          title={feed.paused ? "Resume ingestion" : "Pause ingestion"}
          className="h-8 w-8"
        >
          {feed.paused ? <Play size={14} /> : <Pause size={14} />}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          title="Remove feed"
          className="h-8 w-8 hover:text-destructive"
        >
          <Trash2 size={14} />
        </Button>
      )}
    </>
  );
}
