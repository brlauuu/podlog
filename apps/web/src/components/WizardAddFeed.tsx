"use client";

import { useState } from "react";
import { FlaskConical, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EpisodePreview {
  guid: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
}

interface FeedPreview {
  title: string | null;
  episodes: EpisodePreview[];
}

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Props {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function WizardAddFeed({ onNext, onBack, onSkip }: Props) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"test" | "selective" | "full">("test");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Selective mode state
  const [previewStep, setPreviewStep] = useState(false);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [selectedGuids, setSelectedGuids] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);

  function toggleGuid(guid: string) {
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Selective mode: fetch preview first
    if (mode === "selective" && !previewStep) {
      setPreviewLoading(true);
      try {
        const resp = await fetch("/api/feeds/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail ?? "Couldn't fetch episodes — check the URL and try again");
        }
        const data: FeedPreview = await resp.json();
        setPreview(data);
        setPreviewStep(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load feed preview");
      } finally {
        setPreviewLoading(false);
      }
      return;
    }

    // Submit feed
    setSubmitting(true);
    try {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          mode,
          selected_guids: mode === "selective" ? Array.from(selectedGuids) : undefined,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to add feed");
      }
      onNext();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setSubmitting(false);
    }
  }

  // Episode picker for selective mode
  if (previewStep && preview) {
    return (
      <div>
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold mb-2">Add Your First Podcast</h2>
          <p className="text-sm text-muted-foreground">Pick which episodes to process.</p>
        </div>

        <div className="rounded-lg border bg-card p-3 mb-3">
          <p className="text-sm font-semibold">{preview.title ?? url}</p>
          <p className="text-xs text-muted-foreground">{preview.episodes.length} episodes</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="max-h-56 overflow-y-auto divide-y rounded-md border">
            {preview.episodes.map((ep) => (
              <label
                key={ep.guid}
                className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedGuids.has(ep.guid)}
                  onChange={() => toggleGuid(ep.guid)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ep.title ?? ep.guid}</p>
                  <p className="text-xs text-muted-foreground">
                    {ep.published_at ? new Date(ep.published_at).toLocaleDateString() : null}
                    {ep.published_at && ep.duration_secs ? " · " : null}
                    {formatDuration(ep.duration_secs)}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{selectedGuids.size} episodes selected</p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreviewStep(false);
                setPreview(null);
                setSelectedGuids(new Set());
                setError(null);
              }}
            >
              ← Back
            </Button>
            <Button type="submit" disabled={selectedGuids.size === 0 || submitting}>
              {submitting ? "Adding..." : `Add ${selectedGuids.size} Episodes`}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // Main feed input + mode selector
  return (
    <div>
      <div className="text-center mb-5">
        <h2 className="text-2xl font-bold mb-2">Add Your First Podcast</h2>
        <p className="text-sm text-muted-foreground">
          Paste an RSS feed URL to get started. We recommend <strong>Test mode</strong> for your first feed — it grabs one episode so you can see results fast.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Feed URL</label>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://feeds.example.com/podcast.xml"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Mode</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("test")}
              className={`flex-1 flex items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "test"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 ring-1 ring-blue-300 dark:ring-blue-700"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <FlaskConical size={14} />
              <div className="text-left">
                <div>Test</div>
                <div className="text-xs opacity-70 font-normal">1 episode — quick trial</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("selective")}
              className={`flex-1 flex items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "selective"
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 ring-1 ring-sky-300 dark:ring-sky-700"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <ListChecks size={14} />
              <div className="text-left">
                <div>Selective</div>
                <div className="text-xs opacity-70 font-normal">Pick specific episodes</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("full")}
              className={`flex-1 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "full"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <div className="text-left">
                <div>Full</div>
                <div className="text-xs opacity-70 font-normal">All episodes + auto-poll</div>
              </div>
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip — I&apos;ll explore first
          </Button>
          <Button type="submit" disabled={submitting || previewLoading}>
            {previewLoading
              ? "Loading..."
              : mode === "selective"
              ? "Next"
              : submitting
              ? "Adding..."
              : "Add Feed"}
          </Button>
        </div>
      </form>
    </div>
  );
}
