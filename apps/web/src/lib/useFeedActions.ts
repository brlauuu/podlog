"use client";

/**
 * Feed mutations shared by /feeds and the podcast page (#1090): promote,
 * poll, pause, make selective, delete. The confirm prompts live here so both
 * pages ask the same question before the same request.
 *
 * Every success invalidates the ["feeds"] query; `onChanged` lets a caller
 * that renders feed data some other way (the podcast page is a Server
 * Component) refresh it too.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

async function patchFeed(id: string, body: Record<string, unknown>) {
  const resp = await fetch(`/api/feeds/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update feed");
  }
  return resp.json();
}

export function useFeedActions(onChanged?: () => void) {
  const queryClient = useQueryClient();
  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ["feeds"] });
    onChanged?.();
  };

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
    onSuccess: changed,
  });

  const pollFeed = useMutation({
    mutationFn: async (id: string) => {
      const resp = await fetch(`/api/feeds/${id}/poll`, { method: "POST" });
      if (!resp.ok) throw new Error("Failed to poll feed");
    },
    onSuccess: changed,
    onError: (err: Error) => console.error("Poll feed error:", err.message),
  });

  // Issue #743: pause / resume ingestion for a feed.
  const togglePause = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) => patchFeed(id, { paused }),
    onSuccess: changed,
    onError: (err: Error) => console.error("Toggle pause error:", err.message),
  });

  // Issue #1045: step a test/full feed down to selective. Keeps everything
  // ingested, stops automatic polling, unpauses (selective has no pause).
  const convertToSelective = useMutation({
    mutationFn: (id: string) => patchFeed(id, { mode: "selective" }),
    onSuccess: changed,
    onError: (err: Error) => console.error("Convert to selective error:", err.message),
  });

  const deleteFeed = useMutation({
    mutationFn: async ({ id, deleteEpisodes }: { id: string; deleteEpisodes: boolean }) => {
      await fetch(`/api/feeds/${id}?delete_episodes=${deleteEpisodes}`, { method: "DELETE" });
    },
    onSuccess: changed,
  });

  return {
    promote(url: string) {
      if (confirm("Promote this feed to full mode? All remaining episodes will be ingested.")) {
        promoteFeed.mutate({ url });
      }
    },
    poll(id: string) {
      pollFeed.mutate(id);
    },
    togglePause(id: string, paused: boolean) {
      togglePause.mutate({ id, paused });
    },
    convertToSelective(id: string) {
      if (
        confirm(
          "Stop ingesting new episodes automatically and pick them by hand instead? " +
            "Everything already ingested stays."
        )
      ) {
        convertToSelective.mutate(id);
      }
    },
    remove(id: string) {
      const deleteEpisodes = confirm("Also delete all episodes and transcripts for this feed?");
      deleteFeed.mutate({ id, deleteEpisodes });
    },
    pollPendingId:
      pollFeed.isPending && typeof pollFeed.variables === "string" ? pollFeed.variables : null,
    pausePendingId:
      togglePause.isPending && togglePause.variables ? togglePause.variables.id : null,
    convertPendingId: convertToSelective.isPending ? (convertToSelective.variables ?? null) : null,
  };
}
