"use client";

/**
 * Feed actions on the podcast page (#1090): the same buttons /feeds shows on
 * the feed's card, so adding episodes or changing mode no longer means
 * leaving the podcast. Delete stays on /feeds -- removing the feed would
 * leave this page with nothing to show.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import AddEpisodesDialog from "@/components/AddEpisodesDialog";
import FeedActions from "@/components/FeedActions";
import { useFeedActions } from "@/lib/useFeedActions";

interface PodcastFeed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
  paused: boolean;
}

export default function PodcastFeedControls({ feed }: { feed: PodcastFeed }) {
  const router = useRouter();
  // The page is a Server Component; refresh it so the new mode, badges and
  // episode list show without a reload.
  const actions = useFeedActions(() => router.refresh());
  const [addingEpisodes, setAddingEpisodes] = useState(false);

  return (
    <div data-testid="podcast-feed-controls" className="flex flex-wrap items-center gap-1">
      <FeedActions
        feed={feed}
        pollPending={actions.pollPendingId === feed.id}
        pausePending={actions.pausePendingId === feed.id}
        convertPending={actions.convertPendingId === feed.id}
        onAddMore={() => setAddingEpisodes(true)}
        onPromote={() => actions.promote(feed.url)}
        onConvertToSelective={() => actions.convertToSelective(feed.id)}
        onPoll={() => actions.poll(feed.id)}
        onTogglePause={() => actions.togglePause(feed.id, !feed.paused)}
      />
      <AddEpisodesDialog
        feed={addingEpisodes ? feed : null}
        onClose={() => setAddingEpisodes(false)}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}
