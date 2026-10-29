"use client";

/**
 * "Add episodes" dialog for an existing selective feed (#487). Lifted out of
 * the /feeds page in #1090 so the podcast page can open it too.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import EpisodeSelectionStep from "@/app/feeds/_components/EpisodeSelectionStep";
import { fetchFeedEpisodeGuids, fetchPreview } from "@/app/feeds/_lib/api";
import type { FeedPreview } from "@/app/feeds/_lib/types";

export interface AddEpisodesFeed {
  id: string;
  url: string;
  title: string | null;
}

interface Props {
  /** The feed to add episodes to; null keeps the dialog closed. */
  feed: AddEpisodesFeed | null;
  onClose: () => void;
  /** Called once the new episodes were accepted, before the dialog closes. */
  onAdded?: () => void;
}

export default function AddEpisodesDialog({ feed, onClose, onAdded }: Props) {
  return (
    <Dialog open={feed !== null} onOpenChange={(open) => !open && onClose()}>
      {feed && (
        // Keyed by feed: switching feeds or closing unmounts the body, which
        // aborts its load and discards its state (#1066).
        <AddEpisodesBody key={feed.id} feed={feed} onClose={onClose} onAdded={onAdded} />
      )}
    </Dialog>
  );
}

function AddEpisodesBody({
  feed,
  onClose,
  onAdded,
}: {
  feed: AddEpisodesFeed;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [existingGuids, setExistingGuids] = useState<Set<string>>(new Set());
  const [selectedGuids, setSelectedGuids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // #1066: closing the dialog used to leave the load running, and its late
  // response landed in whichever dialog was open by then. Aborting frees the
  // browser's request; the `cancelled` check is what guarantees a response
  // that arrives anyway is dropped.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    Promise.all([
      fetchPreview(feed.url, controller.signal),
      fetchFeedEpisodeGuids(feed.id, controller.signal),
    ])
      .then(([data, existing]) => {
        if (cancelled) return;
        const existingSet = new Set(existing);
        setPreview(data);
        setExistingGuids(existingSet);
        setSelectedGuids(new Set(existingSet));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load feed preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [feed.id, feed.url]);

  const addEpisodes = useMutation({
    mutationFn: async (selected_guids: string[]) => {
      const resp = await fetch(`/api/feeds/${feed.id}/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_guids }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to add episodes");
      }
      return resp.json();
    },
    onSuccess: () => {
      onAdded?.();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  // Submit only the newly-picked GUIDs; existing ones are shown locked.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const newPicks = Array.from(selectedGuids).filter((g) => !existingGuids.has(g));
    if (newPicks.length === 0) {
      setError("Select at least one new episode to add.");
      return;
    }
    addEpisodes.mutate(newPicks);
  }

  function toggleGuid(guid: string) {
    if (existingGuids.has(guid)) return;
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  // `scopeGuids` is what the selection step has on screen (#982); selections
  // outside it are preserved, and episodes the feed already has never change.
  function toggleAll(scopeGuids?: string[]) {
    if (!preview) return;
    // Array check, not a null check: wired straight to an onClick this would
    // receive a MouseEvent.
    const scope = Array.isArray(scopeGuids) ? scopeGuids : preview.episodes.map((e) => e.guid);
    const togglable = scope.filter((g) => !existingGuids.has(g));
    if (togglable.length === 0) return;

    const allTogglableSelected = togglable.every((g) => selectedGuids.has(g));
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (allTogglableSelected) togglable.forEach((g) => next.delete(g));
      else togglable.forEach((g) => next.add(g));
      return next;
    });
  }

  const title = preview?.title ?? feed.title;

  return (
    <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>{`Add episodes${title ? ` — ${title}` : ""}`}</DialogTitle>
      </DialogHeader>

      {loading && <p className="text-sm text-muted-foreground py-4">Loading episodes...</p>}

      {!loading && !preview && error && <p className="text-sm text-destructive py-4">{error}</p>}

      {preview && (
        <EpisodeSelectionStep
          preview={preview}
          selectedGuids={selectedGuids}
          existingGuids={existingGuids}
          addMoreMode
          error={error}
          submitting={addEpisodes.isPending}
          onToggleGuid={toggleGuid}
          onToggleAll={toggleAll}
          onSubmit={handleSubmit}
          onBackOrCancel={onClose}
        />
      )}
    </DialogContent>
  );
}
