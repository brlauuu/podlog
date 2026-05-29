"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import FeedsListSection from "@/components/FeedsListSection";
import AddFeedStep1, { type AddMode } from "./_components/AddFeedStep1";
import EpisodeSelectionStep from "./_components/EpisodeSelectionStep";
import {
  fetchFeedEpisodeGuids,
  fetchFeeds,
  fetchPreview,
} from "./_lib/api";
import type { Feed, FeedPreview } from "./_lib/types";

export default function FeedsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [addMode, setAddMode] = useState<AddMode>("test");
  const [addError, setAddError] = useState<string | null>(null);

  // Issue #84: episode selection state
  const [previewStep, setPreviewStep] = useState(false);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [selectedGuids, setSelectedGuids] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Issue #487: adding more episodes to an existing selective feed.
  // When set, the dialog is reused in "add more" mode: preview is reloaded for
  // the feed's URL, and already-ingested GUIDs are shown checked+disabled.
  const [addMoreFeed, setAddMoreFeed] = useState<Feed | null>(null);
  const [existingGuids, setExistingGuids] = useState<Set<string>>(new Set());

  const { data: feeds = [], isLoading } = useQuery({ queryKey: ["feeds"], queryFn: fetchFeeds });

  function resetModal() {
    setShowAddModal(false);
    setNewUrl("");
    setAddMode("test");
    setAddError(null);
    setPreviewStep(false);
    setPreview(null);
    setSelectedGuids(new Set());
    setAddMoreFeed(null);
    setExistingGuids(new Set());
  }

  const addFeed = useMutation({
    mutationFn: async ({
      url,
      mode,
      selected_guids,
    }: {
      url: string;
      mode: string;
      selected_guids?: string[];
    }) => {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode, selected_guids }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail ?? "Failed to add feed");
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feeds"] });
      resetModal();
    },
    onError: (err: Error) => setAddError(err.message),
  });

  // Issue #487: add more episodes to an existing selective feed.
  const addEpisodes = useMutation({
    mutationFn: async ({
      feedId,
      selected_guids,
    }: {
      feedId: string;
      selected_guids: string[];
    }) => {
      const resp = await fetch(`/api/feeds/${feedId}/episodes`, {
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
      queryClient.invalidateQueries({ queryKey: ["feeds"] });
      resetModal();
    },
    onError: (err: Error) => setAddError(err.message),
  });

  async function handleAddMore(feed: Feed) {
    setAddMoreFeed(feed);
    setShowAddModal(true);
    setAddError(null);
    setPreviewLoading(true);
    try {
      const [data, existing] = await Promise.all([
        fetchPreview(feed.url),
        fetchFeedEpisodeGuids(feed.id),
      ]);
      const existingSet = new Set(existing);
      setPreview(data);
      setExistingGuids(existingSet);
      setSelectedGuids(new Set(existingSet));
      setPreviewStep(true);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Failed to load feed preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  const promoteFeed = useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode: "full" }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail ?? "Failed to promote feed");
      }
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
  });

  const pollFeed = useMutation({
    mutationFn: async (id: string) => {
      const resp = await fetch(`/api/feeds/${id}/poll`, { method: "POST" });
      if (!resp.ok) throw new Error("Failed to poll feed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
    onError: (err: Error) => console.error("Poll feed error:", err.message),
  });

  // Issue #743: pause / resume ingestion for a feed.
  const togglePause = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const resp = await fetch(`/api/feeds/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to update feed");
      }
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
    onError: (err: Error) => console.error("Toggle pause error:", err.message),
  });

  const deleteFeed = useMutation({
    mutationFn: async ({ id, deleteEpisodes }: { id: string; deleteEpisodes: boolean }) => {
      await fetch(`/api/feeds/${id}?delete_episodes=${deleteEpisodes}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
  });

  // Issue #84: fetch episode list for selective mode before submitting.
  // Issue #487: in "add more" mode, submit only the newly-picked GUIDs.
  async function handleAddOrPreview(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (addMoreFeed) {
      const newPicks = Array.from(selectedGuids).filter((g) => !existingGuids.has(g));
      if (newPicks.length === 0) {
        setAddError("Select at least one new episode to add.");
        return;
      }
      addEpisodes.mutate({ feedId: addMoreFeed.id, selected_guids: newPicks });
      return;
    }
    if (addMode === "selective" && !previewStep) {
      setPreviewLoading(true);
      try {
        const data = await fetchPreview(newUrl.trim());
        setPreview(data);
        setPreviewStep(true);
      } catch (err: unknown) {
        setAddError(err instanceof Error ? err.message : "Failed to load feed preview");
      } finally {
        setPreviewLoading(false);
      }
      return;
    }
    addFeed.mutate({
      url: newUrl.trim(),
      mode: addMode,
      selected_guids: addMode === "selective" ? Array.from(selectedGuids) : undefined,
    });
  }

  function toggleGuid(guid: string) {
    // Issue #487: already-ingested episodes are locked in add-more mode
    if (addMoreFeed && existingGuids.has(guid)) return;
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    const allGuids = preview.episodes.map((e) => e.guid);
    if (addMoreFeed) {
      // Issue #487: preserve existing selections; toggle only the remaining episodes
      const togglable = allGuids.filter((g) => !existingGuids.has(g));
      const allTogglableSelected = togglable.every((g) => selectedGuids.has(g));
      setSelectedGuids((prev) => {
        const next = new Set(prev);
        if (allTogglableSelected) {
          togglable.forEach((g) => next.delete(g));
        } else {
          togglable.forEach((g) => next.add(g));
        }
        return next;
      });
      return;
    }
    if (selectedGuids.size === allGuids.length) {
      setSelectedGuids(new Set());
    } else {
      setSelectedGuids(new Set(allGuids));
    }
  }

  const dialogTitle = addMoreFeed
    ? `Add episodes${
        preview?.title
          ? ` — ${preview.title}`
          : addMoreFeed.title
          ? ` — ${addMoreFeed.title}`
          : ""
      }`
    : previewStep
    ? `Select episodes${preview?.title ? ` — ${preview.title}` : ""}`
    : "Add RSS Feed";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span />
        <Dialog
          open={showAddModal}
          onOpenChange={(open) => {
            if (!open) resetModal();
            else setShowAddModal(true);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus size={14} />
              Add Feed
            </Button>
          </DialogTrigger>
          <DialogContent
            className={previewStep || addMoreFeed ? "max-w-2xl flex flex-col max-h-[90vh]" : undefined}
          >
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
            </DialogHeader>

            {/* Loading state while fetching preview for add-more flow */}
            {addMoreFeed && previewLoading && (
              <p className="text-sm text-muted-foreground py-4">Loading episodes...</p>
            )}

            {/* Step 1: URL + mode (only when not in add-more flow) */}
            {!previewStep && !addMoreFeed && (
              <AddFeedStep1
                url={newUrl}
                onUrlChange={setNewUrl}
                mode={addMode}
                onModeChange={setAddMode}
                error={addError}
                submitting={addFeed.isPending}
                previewLoading={previewLoading}
                onSubmit={handleAddOrPreview}
                onCancel={resetModal}
              />
            )}

            {/* Step 2: Episode selection (selective add or add-more) */}
            {(previewStep || addMoreFeed) && preview && (
              <EpisodeSelectionStep
                preview={preview}
                selectedGuids={selectedGuids}
                existingGuids={existingGuids}
                addMoreMode={!!addMoreFeed}
                error={addError}
                submitting={addMoreFeed ? addEpisodes.isPending : addFeed.isPending}
                onToggleGuid={toggleGuid}
                onToggleAll={toggleAll}
                onSubmit={handleAddOrPreview}
                onBackOrCancel={() => {
                  if (addMoreFeed) {
                    resetModal();
                    return;
                  }
                  setPreviewStep(false);
                  setPreview(null);
                  setSelectedGuids(new Set());
                  setAddError(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>

      <FeedsListSection
        isLoading={isLoading}
        feeds={feeds}
        pollPendingId={
          pollFeed.isPending && typeof pollFeed.variables === "string"
            ? pollFeed.variables
            : null
        }
        onAddFirstFeed={() => setShowAddModal(true)}
        onPromote={(url) => {
          if (confirm("Promote this feed to full mode? All remaining episodes will be ingested.")) {
            promoteFeed.mutate({ url });
          }
        }}
        onPoll={(feedId) => pollFeed.mutate(feedId)}
        onDelete={(feedId) => {
          const deleteEps = confirm(
            "Also delete all episodes and transcripts for this feed?"
          );
          deleteFeed.mutate({ id: feedId, deleteEpisodes: deleteEps });
        }}
        onAddMore={handleAddMore}
        pausePendingId={
          togglePause.isPending && togglePause.variables
            ? togglePause.variables.id
            : null
        }
        onTogglePause={(feedId, paused) =>
          togglePause.mutate({ id: feedId, paused })
        }
      />
    </div>
  );
}
