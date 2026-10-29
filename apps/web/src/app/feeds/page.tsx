"use client";

import { useRef, useState } from "react";
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
import AddEpisodesDialog from "@/components/AddEpisodesDialog";
import FeedsListSection from "@/components/FeedsListSection";
import { useFeedActions } from "@/lib/useFeedActions";
import AddFeedStep1, { type AddMode } from "./_components/AddFeedStep1";
import EpisodeSelectionStep from "./_components/EpisodeSelectionStep";
import { fetchFeeds, fetchPreview } from "./_lib/api";
import type { Feed, FeedPreview } from "./_lib/types";

// A new feed has no episodes yet, so nothing in its picker is locked.
const NO_GUIDS = new Set<string>();

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

  // Issue #487: the selective feed the "Add episodes" dialog is open for.
  const [addMoreFeed, setAddMoreFeed] = useState<Feed | null>(null);
  const feedActions = useFeedActions();

  const { data: feeds = [], isLoading } = useQuery({ queryKey: ["feeds"], queryFn: fetchFeeds });

  // #1066: the preview load in flight, if any. Closing the dialog used to
  // leave it running, and its late response was written into whichever
  // dialog was open by then -- feed B's picker showed feed A's episodes and
  // would have posted them to feed B. Aborting frees the browser's request;
  // the identity check is what guarantees a response that arrives anyway is
  // dropped.
  const previewRequest = useRef<AbortController | null>(null);

  function cancelPreview() {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreviewLoading(false);
  }

  function beginPreview(): AbortController {
    cancelPreview();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewLoading(true);
    return controller;
  }

  function resetModal() {
    cancelPreview();
    setShowAddModal(false);
    setNewUrl("");
    setAddMode("test");
    setAddError(null);
    setPreviewStep(false);
    setPreview(null);
    setSelectedGuids(new Set());
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

  // Issue #84: fetch episode list for selective mode before submitting.
  async function handleAddOrPreview(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (addMode === "selective" && !previewStep) {
      const request = beginPreview();
      try {
        const data = await fetchPreview(newUrl.trim(), request.signal);
        if (previewRequest.current !== request) return;
        setPreview(data);
        setPreviewStep(true);
      } catch (err: unknown) {
        if (previewRequest.current !== request) return;
        setAddError(err instanceof Error ? err.message : "Failed to load feed preview");
      } finally {
        if (previewRequest.current === request) {
          previewRequest.current = null;
          setPreviewLoading(false);
        }
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
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  /**
   * Select/deselect in bulk.
   *
   * `scopeGuids` is what the selection step currently has on screen (#982).
   * With no filter active that is the whole feed, so this behaves exactly as
   * it did before. With a filter active it must touch only the visible
   * episodes -- clicking "Select all" while looking at 12 of 357 and getting
   * all 357 would be a nasty surprise.
   *
   * Selections outside the scope are always preserved: this adds to or
   * removes from the existing set rather than replacing it.
   */
  function toggleAll(scopeGuids?: string[]) {
    if (!preview) return;
    const allGuids = preview.episodes.map((e) => e.guid);
    // Array check, not a null check: wiring this callback straight to an
    // onClick hands it a MouseEvent, which `?? allGuids` would happily accept
    // and then crash on .filter.
    const togglable = Array.isArray(scopeGuids) ? scopeGuids : allGuids;
    if (togglable.length === 0) return;

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
  }

  const dialogTitle = previewStep
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
            className={previewStep ? "max-w-2xl flex flex-col max-h-[90vh]" : undefined}
          >
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
            </DialogHeader>

            {/* Step 1: URL + mode */}
            {!previewStep && (
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

            {/* Step 2: Episode selection */}
            {previewStep && preview && (
              <EpisodeSelectionStep
                preview={preview}
                selectedGuids={selectedGuids}
                existingGuids={NO_GUIDS}
                addMoreMode={false}
                error={addError}
                submitting={addFeed.isPending}
                onToggleGuid={toggleGuid}
                onToggleAll={toggleAll}
                onSubmit={handleAddOrPreview}
                onBackOrCancel={() => {
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

      <AddEpisodesDialog
        feed={addMoreFeed}
        onClose={() => setAddMoreFeed(null)}
        onAdded={() => queryClient.invalidateQueries({ queryKey: ["feeds"] })}
      />

      <FeedsListSection
        isLoading={isLoading}
        feeds={feeds}
        pollPendingId={feedActions.pollPendingId}
        onAddFirstFeed={() => setShowAddModal(true)}
        onPromote={feedActions.promote}
        onPoll={feedActions.poll}
        onDelete={feedActions.remove}
        onAddMore={setAddMoreFeed}
        pausePendingId={feedActions.pausePendingId}
        onTogglePause={feedActions.togglePause}
        convertPendingId={feedActions.convertPendingId}
        onConvertToSelective={feedActions.convertToSelective}
      />
    </div>
  );
}
