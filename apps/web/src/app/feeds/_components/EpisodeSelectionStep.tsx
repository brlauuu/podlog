"use client";

/**
 * Step 2 of the Add Feed dialog: episode-selection list. Used for both
 * the selective-mode add flow and the issue #487 "add more" flow against
 * an existing selective feed. Split out of page.tsx in #664.
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dateFormat";
import type { FeedPreview } from "../_lib/types";
import { formatDuration } from "../_lib/types";

interface Props {
  preview: FeedPreview;
  selectedGuids: Set<string>;
  existingGuids: Set<string>;
  /** Non-null when the dialog is in the issue-#487 "add more" flow. */
  addMoreMode: boolean;
  error: string | null;
  submitting: boolean;
  onToggleGuid: (guid: string) => void;
  /**
   * Receives the guids the select-all should act on: the currently visible,
   * selectable episodes (#982). With no filter that is the whole feed, so
   * the parent's behaviour is unchanged.
   */
  onToggleAll: (visibleGuids: string[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBackOrCancel: () => void;
}

export default function EpisodeSelectionStep({
  preview,
  selectedGuids,
  existingGuids,
  addMoreMode,
  error,
  submitting,
  onToggleGuid,
  onToggleAll,
  onSubmit,
  onBackOrCancel,
}: Props) {
  // #982: long feeds (350+ episodes here) were one flat scroll with no way
  // to find a specific episode. The filter narrows what is *rendered* only --
  // never the selection, so an episode checked and then filtered out of view
  // stays checked and still submits.
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const filtering = trimmed.length > 0;

  const visible = useMemo(() => {
    if (!filtering) return preview.episodes;
    return preview.episodes.filter((e) =>
      (e.title ?? e.guid).toLowerCase().includes(trimmed),
    );
  }, [preview.episodes, filtering, trimmed]);

  /** Visible episodes the select-all is allowed to touch. */
  const togglableVisible = addMoreMode
    ? visible.filter((e) => !existingGuids.has(e.guid))
    : visible;

  const toggleAllLabel = (() => {
    if (addMoreMode) {
      const remaining = preview.episodes.filter((e) => !existingGuids.has(e.guid));
      const allRemainingSelected =
        remaining.length > 0 &&
        remaining.every((e) => selectedGuids.has(e.guid));
      if (filtering) return `Select all ${togglableVisible.length} new shown`;
      return allRemainingSelected ? "Deselect all new" : "Select all new";
    }
    if (filtering) return `Select all ${togglableVisible.length} shown`;
    return selectedGuids.size === preview.episodes.length
      ? "Deselect all"
      : "Select all";
  })();

  const newCount = addMoreMode
    ? Array.from(selectedGuids).filter((g) => !existingGuids.has(g)).length
    : 0;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col flex-1 overflow-hidden space-y-3 min-h-0"
    >
      <div className="flex items-center justify-between shrink-0">
        <span className="text-sm text-muted-foreground">
          {filtering
            ? `${visible.length} of ${preview.episodes.length} episodes`
            : `${preview.episodes.length} episodes found`}
          {addMoreMode && existingGuids.size > 0
            ? ` · ${existingGuids.size} already added`
            : null}
        </span>
        <button
          type="button"
          onClick={() => onToggleAll(togglableVisible.map((e) => e.guid))}
          className="text-xs text-link underline"
        >
          {toggleAllLabel}
        </button>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter episodes by title..."
        aria-label="Filter episodes by title"
        className="shrink-0 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y rounded-md border min-h-[80px]">
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No episodes match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : null}
        {visible.map((ep) => {
          const already = addMoreMode && existingGuids.has(ep.guid);
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
                onChange={() => onToggleGuid(ep.guid)}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {ep.title ?? ep.guid}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ep.published_at ? formatDate(ep.published_at) : null}
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
      {error && <p className="text-sm text-destructive shrink-0">{error}</p>}
      <div className="flex justify-end gap-2 shrink-0">
        <Button type="button" variant="outline" onClick={onBackOrCancel}>
          {addMoreMode ? "Cancel" : "Back"}
        </Button>
        {addMoreMode ? (
          <Button type="submit" disabled={newCount === 0 || submitting}>
            {submitting
              ? "Adding..."
              : `Add ${newCount} episode${newCount === 1 ? "" : "s"}`}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={selectedGuids.size === 0 || submitting}
          >
            {submitting ? "Adding..." : `Add (${selectedGuids.size})`}
          </Button>
        )}
      </div>
    </form>
  );
}
