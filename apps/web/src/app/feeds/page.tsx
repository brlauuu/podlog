"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Feed {
  id: string;
  url: string;
  title: string | null;
  mode: string;
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
  const [addMode, setAddMode] = useState<"test" | "full">("test");
  const [addError, setAddError] = useState<string | null>(null);

  const { data: feeds = [], isLoading } = useQuery({ queryKey: ["feeds"], queryFn: fetchFeeds });

  const addFeed = useMutation({
    mutationFn: async ({ url, mode }: { url: string; mode: string }) => {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
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
      setAddMode("test");
      setAddError(null);
    },
    onError: (err: Error) => setAddError(err.message),
  });

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feeds</h1>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus size={14} />
              Add Feed
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add RSS Feed</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addFeed.mutate({ url: newUrl.trim(), mode: addMode });
              }}
              className="space-y-4"
            >
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
                      ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <FlaskConical size={14} />
                  Test (5 episodes)
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode("full")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    addMode === "full"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  Full
                </button>
              </div>
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addFeed.isPending}>
                  {addFeed.isPending ? "Adding..." : "Add"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
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
            <Card key={feed.id} className="hover:bg-accent/30 transition-colors">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{feed.title ?? feed.url}</p>
                    {feed.mode === "test" && (
                      <Badge variant="outline" className="shrink-0 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-1">
                        <FlaskConical size={10} />
                        Test
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{feed.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {feed.episode_count} episodes ·{" "}
                    {feed.last_polled_at
                      ? `Last polled ${new Date(feed.last_polled_at).toLocaleString()}`
                      : "Never polled"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {feed.mode === "test" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Promote this feed to full mode? All remaining episodes will be ingested.")) {
                          promoteFeed.mutate({ url: feed.url });
                        }
                      }}
                      className="h-8 text-xs"
                    >
                      Promote to Full
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => pollFeed.mutate(feed.id)}
                    disabled={pollFeed.isPending && pollFeed.variables === feed.id}
                    title="Poll now"
                    className="h-8 w-8"
                  >
                    <RefreshCw size={14} className={pollFeed.isPending && pollFeed.variables === feed.id ? "animate-spin" : ""} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const deleteEps = confirm(
                        "Also delete all episodes and transcripts for this feed?"
                      );
                      deleteFeed.mutate({ id: feed.id, deleteEpisodes: deleteEps });
                    }}
                    title="Remove feed"
                    className="h-8 w-8 hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
