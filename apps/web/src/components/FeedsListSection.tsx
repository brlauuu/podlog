import FeedCard from "@/components/FeedCard";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Feed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
  last_polled_at: string | null;
  episode_count: number;
}

interface FeedsListSectionProps {
  isLoading: boolean;
  feeds: Feed[];
  pollPendingId: string | null;
  onAddFirstFeed: () => void;
  onPromote: (url: string) => void;
  onPoll: (feedId: string) => void;
  onDelete: (feedId: string) => void;
  onAddMore?: (feed: Feed) => void;
}

export default function FeedsListSection({
  isLoading,
  feeds,
  pollPendingId,
  onAddFirstFeed,
  onPromote,
  onPoll,
  onDelete,
  onAddMore,
}: FeedsListSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (feeds.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">No feeds yet.</p>
        <button
          onClick={onAddFirstFeed}
          className="mt-2 text-sm text-link underline"
        >
          Add your first RSS feed
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {feeds.map((feed) => (
        <FeedCard
          key={feed.id}
          feed={feed}
          pollPending={pollPendingId === feed.id}
          onPromote={onPromote}
          onPoll={onPoll}
          onDelete={onDelete}
          onAddMore={onAddMore}
        />
      ))}
    </div>
  );
}
