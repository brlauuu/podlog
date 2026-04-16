"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AudioUpload from "@/components/AudioUpload";
import EpisodeCard, { type EnrichedEpisode } from "@/components/EpisodeCard";

export interface UploadedEpisode extends EnrichedEpisode {
  description: string | null;
}

interface Props {
  uploads: UploadedEpisode[];
  processed: number;
  total: number;
}

export default function UploadsSection({ uploads, processed, total }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return uploads;
    const q = searchQuery.toLowerCase();
    return uploads.filter((u) => {
      const titleMatch = u.title?.toLowerCase().includes(q) ?? false;
      const descMatch = u.description?.toLowerCase().includes(q) ?? false;
      return titleMatch || descMatch;
    });
  }, [uploads, searchQuery]);

  const handleUploaded = useCallback(() => {
    setDialogOpen(false);
    router.refresh();
  }, [router]);

  const handleDelete = useCallback(
    async (episode: EnrichedEpisode) => {
      const label = episode.title ?? "this upload";
      if (!confirm(`Delete "${label}"? The audio file and transcript will be removed.`)) return;
      setDeletingId(episode.id);
      try {
        const resp = await fetch(`/api/episodes/${episode.id}`, { method: "DELETE" });
        if (!resp.ok && resp.status !== 204) {
          const body = await resp.json().catch(() => ({}));
          alert(body.detail ?? "Failed to delete episode");
          return;
        }
        router.refresh();
      } finally {
        setDeletingId(null);
      }
    },
    [router]
  );

  const toggleError = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xl font-semibold">
          Manual uploads
          {total > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({processed === total
                ? `${total} file${total !== 1 ? "s" : ""}`
                : `${processed} / ${total} processed`})
            </span>
          )}
        </h2>
        <Button
          onClick={() => setDialogOpen(true)}
          className="h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3"
        >
          <Upload />
          Upload audio
        </Button>
      </div>

      {total > 0 && (
        <div className="relative mb-3 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search uploads by title or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
            aria-label="Search manual uploads"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No uploads yet. Click &ldquo;Upload audio&rdquo; to add one.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No uploads match your search</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((ep) => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              expandedError={expandedErrors.has(ep.id)}
              onToggleError={toggleError}
              onDelete={handleDelete}
              deleting={deletingId === ep.id}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload audio</DialogTitle>
          </DialogHeader>
          <AudioUpload onUploaded={handleUploaded} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
