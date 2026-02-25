"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

interface Feed {
  id: string;
  url: string;
  title: string | null;
  last_polled_at: string | null;
  episode_count: number;
}

async function fetchFeeds(): Promise<Feed[]> {
  const resp = await fetch("/api/feeds");
  if (!resp.ok) throw new Error("Failed to load feeds");
  return resp.json();
}

export default function FeedsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { data: feeds = [], isLoading } = useQuery({ queryKey: ["feeds"], queryFn: fetchFeeds });

  const addFeed = useMutation({
    mutationFn: async (url: string) => {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail ?? "Failed to add feed");
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feeds"] });
      setShowAddModal(false);
      setNewUrl("");
      setAddError(null);
    },
    onError: (err: Error) => setAddError(err.message),
  });

  const pollFeed = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/feeds/${id}/poll`, { method: "POST" });
    },
  });

  const deleteFeed = useMutation({
    mutationFn: async ({ id, deleteEpisodes }: { id: string; deleteEpisodes: boolean }) => {
      await fetch(`/api/feeds/${id}?delete_episodes=${deleteEpisodes}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feeds</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          Add Feed
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted-foreground">No feeds yet.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-2 text-sm text-primary underline"
          >
            Add your first RSS feed
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {feeds.map((feed) => (
            <div
              key={feed.id}
              className="border border-border rounded-lg p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{feed.title ?? feed.url}</p>
                <p className="text-xs text-muted-foreground truncate">{feed.url}</p>
                <p className="text-xs text-muted-foreground">
                  {feed.episode_count} episodes ·{" "}
                  {feed.last_polled_at
                    ? `Last polled ${new Date(feed.last_polled_at).toLocaleString()}`
                    : "Never polled"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => pollFeed.mutate(feed.id)}
                  title="Poll now"
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-accent transition-colors"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => {
                    const deleteEps = confirm(
                      "Also delete all episodes and transcripts for this feed?"
                    );
                    deleteFeed.mutate({ id: feed.id, deleteEpisodes: deleteEps });
                  }}
                  title="Remove feed"
                  className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-accent transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Feed Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Add RSS Feed</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addFeed.mutate(newUrl.trim());
              }}
              className="space-y-3"
            >
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://feeds.example.com/podcast.xml"
                required
                autoFocus
                className="w-full border border-input rounded px-3 py-2 text-sm bg-background"
              />
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-sm px-3 py-1.5 border border-border rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addFeed.isPending}
                  className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-60"
                >
                  {addFeed.isPending ? "Adding..." : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
