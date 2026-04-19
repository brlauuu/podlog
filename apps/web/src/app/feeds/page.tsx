"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FlaskConical, ListChecks } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FeedsListSection from "@/components/FeedsListSection";

interface Feed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
  last_polled_at: string | null;
  episode_count: number;
}

// Issue #84: episode preview shape returned by GET /api/feeds/preview
interface EpisodePreview {
  guid: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
  audio_url: string;
}

interface FeedPreview {
  title: string | null;
  episodes: EpisodePreview[];
}

async function fetchFeeds(): Promise<Feed[]> {
  const resp = await fetch("/api/feeds");
  if (!resp.ok) throw new Error("Failed to load feeds");
  return resp.json();
}

async function fetchPreview(url: string): Promise<FeedPreview> {
  const resp = await fetch(`/api/feeds/preview?url=${encodeURIComponent(url)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load feed preview");
  }
  return resp.json();
}

async function fetchFeedEpisodeGuids(feedId: string): Promise<string[]> {
  const resp = await fetch(`/api/feeds/${feedId}/episodes/guids`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to load existing episodes");
  }
  return resp.json();
}

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function FeedsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [addMode, setAddMode] = useState<"test" | "full" | "selective">("test");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span />
        <Dialog open={showAddModal} onOpenChange={(open) => { if (!open) resetModal(); else setShowAddModal(true); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus size={14} />
              Add Feed
            </Button>
          </DialogTrigger>
          <DialogContent className={previewStep || addMoreFeed ? "max-w-2xl flex flex-col max-h-[90vh]" : undefined}>
            <DialogHeader>
              <DialogTitle>
                {addMoreFeed
                  ? `Add episodes${preview?.title ? ` — ${preview.title}` : addMoreFeed.title ? ` — ${addMoreFeed.title}` : ""}`
                  : previewStep
                  ? `Select episodes${preview?.title ? ` — ${preview.title}` : ""}`
                  : "Add RSS Feed"}
              </DialogTitle>
            </DialogHeader>

            {/* Loading state while fetching preview for add-more flow */}
            {addMoreFeed && previewLoading && (
              <p className="text-sm text-muted-foreground py-4">Loading episodes...</p>
            )}

            {/* Step 1: URL + mode (only when not in add-more flow) */}
            {!previewStep && !addMoreFeed && (
              <form onSubmit={handleAddOrPreview} className="space-y-4">
                <Input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://feeds.example.com/podcast.xml"
                  required
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAddMode("test")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      addMode === "test"
                        ? "bg-action text-action-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <FlaskConical size={14} />
                    Test (1 episode)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode("selective")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      addMode === "selective"
                        ? "bg-action text-action-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <ListChecks size={14} />
                    Select episodes
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode("full")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      addMode === "full"
                        ? "bg-action text-action-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    Full
                  </button>
                </div>
                {addError && <p className="text-sm text-destructive">{addError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={resetModal}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addFeed.isPending || previewLoading}>
                    {previewLoading
                      ? "Loading..."
                      : addMode === "selective"
                      ? "Next"
                      : addFeed.isPending
                      ? "Adding..."
                      : "Add"}
                  </Button>
                </div>
              </form>
            )}

            {/* Step 2: Episode selection (selective add or add-more) */}
            {(previewStep || addMoreFeed) && preview && (
              <form onSubmit={handleAddOrPreview} className="flex flex-col flex-1 overflow-hidden space-y-3 min-h-0">
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-sm text-muted-foreground">
                    {preview.episodes.length} episodes found
                    {addMoreFeed && existingGuids.size > 0
                      ? ` · ${existingGuids.size} already added`
                      : null}
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-link underline"
                  >
                    {(() => {
                      if (addMoreFeed) {
                        const remaining = preview.episodes.filter((e) => !existingGuids.has(e.guid));
                        const allRemainingSelected =
                          remaining.length > 0 &&
                          remaining.every((e) => selectedGuids.has(e.guid));
                        return allRemainingSelected ? "Deselect all new" : "Select all new";
                      }
                      return selectedGuids.size === preview.episodes.length
                        ? "Deselect all"
                        : "Select all";
                    })()}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y rounded-md border min-h-[80px]">
                  {preview.episodes.map((ep) => {
                    const already = !!addMoreFeed && existingGuids.has(ep.guid);
                    return (
                      <label
                        key={ep.guid}
                        className={`flex items-start gap-3 px-3 py-2 transition-colors ${
                          already
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer hover:bg-accent/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedGuids.has(ep.guid)}
                          disabled={already}
                          onChange={() => toggleGuid(ep.guid)}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{ep.title ?? ep.guid}</p>
                          <p className="text-xs text-muted-foreground">
                            {ep.published_at
                              ? new Date(ep.published_at).toLocaleDateString()
                              : null}
                            {ep.published_at && ep.duration_secs ? " · " : null}
                            {formatDuration(ep.duration_secs)}
                            {already ? (
                              <span className="ml-2 italic">(already added)</span>
                            ) : null}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {addError && <p className="text-sm text-destructive shrink-0">{addError}</p>}
                <div className="flex justify-end gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (addMoreFeed) {
                        resetModal();
                        return;
                      }
                      setPreviewStep(false);
                      setPreview(null);
                      setSelectedGuids(new Set());
                      setAddError(null);
                    }}
                  >
                    {addMoreFeed ? "Cancel" : "Back"}
                  </Button>
                  {addMoreFeed ? (
                    (() => {
                      const newCount = Array.from(selectedGuids).filter(
                        (g) => !existingGuids.has(g),
                      ).length;
                      return (
                        <Button
                          type="submit"
                          disabled={newCount === 0 || addEpisodes.isPending}
                        >
                          {addEpisodes.isPending
                            ? "Adding..."
                            : `Add ${newCount} episode${newCount === 1 ? "" : "s"}`}
                        </Button>
                      );
                    })()
                  ) : (
                    <Button
                      type="submit"
                      disabled={selectedGuids.size === 0 || addFeed.isPending}
                    >
                      {addFeed.isPending
                        ? "Adding..."
                        : `Add (${selectedGuids.size})`}
                    </Button>
                  )}
                </div>
              </form>
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
      />
    </div>
  );
}
