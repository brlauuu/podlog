"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Search, X } from "lucide-react";

import EpisodeCard, { PROCESSING_STEPS } from "./EpisodeCard";
import { Input } from "@/components/ui/input";

export type { EnrichedEpisode, SpeakerNameTag } from "./EpisodeCard";
import type { EnrichedEpisode } from "./EpisodeCard";

type SortKey = "published_at" | "status" | "duration_secs" | "processed_at" | "title";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "published_at", label: "Published" },
  { key: "status", label: "Status" },
  { key: "duration_secs", label: "Duration" },
  { key: "processed_at", label: "Processed" },
  { key: "title", label: "Title" },
];

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  transcribing: 1,
  diarizing: 2,
  archiving: 3,
  pending: 4,
  failed: 5,
  done: 6,
};

function StatsBar({
  episodes,
  filteredCount,
  searchQuery,
}: {
  episodes: EnrichedEpisode[];
  filteredCount: number;
  searchQuery: string;
}) {
  const counts = useMemo(() => {
    const c = { total: episodes.length, done: 0, processing: 0, failed: 0, pending: 0 };
    for (const ep of episodes) {
      if (ep.status === "done") c.done++;
      else if (ep.status === "failed") c.failed++;
      else if (ep.status === "pending") c.pending++;
      else c.processing++;
    }
    return c;
  }, [episodes]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {searchQuery ? (
        <span className="font-medium text-foreground">
          Showing {filteredCount} of {counts.total} episodes
        </span>
      ) : (
        <span className="font-medium text-foreground">{counts.total} episodes</span>
      )}
      <span className="text-muted-foreground/50">·</span>
      <span>{counts.done} transcribed</span>
      {counts.processing > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-blue-600 dark:text-blue-400">{counts.processing} processing</span>
        </>
      )}
      {counts.failed > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-red-600 dark:text-red-400">{counts.failed} failed</span>
        </>
      )}
      {counts.pending > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span>{counts.pending} pending</span>
        </>
      )}
    </div>
  );
}

const STORAGE_KEY = "podlog-episodes-sort";

interface Props {
  episodes: EnrichedEpisode[];
  feedId: string;
}

export default function EpisodesList({ episodes }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { key, dir } = JSON.parse(stored);
        if (SORT_OPTIONS.some((o) => o.key === key)) setSortKey(key);
        if (dir === "asc" || dir === "desc") setSortDir(dir);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch {}
  }, [sortKey, sortDir]);

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase();
    const filtered = searchQuery
      ? episodes.filter(
          (ep) =>
            ep.title?.toLowerCase().includes(normalizedQuery) ||
            ep.speaker_name_tags?.some((sn) =>
              sn.display_name.toLowerCase().includes(normalizedQuery)
            )
        )
      : episodes;

    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case "duration_secs":
          cmp = (a.duration_secs ?? 0) - (b.duration_secs ?? 0);
          break;
        case "processed_at": {
          const ta = a.processed_at ? new Date(a.processed_at).getTime() : 0;
          const tb = b.processed_at ? new Date(b.processed_at).getTime() : 0;
          cmp = ta - tb;
          break;
        }
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "published_at":
        default: {
          const pa = a.published_at ? new Date(a.published_at).getTime() : 0;
          const pb = b.published_at ? new Date(b.published_at).getTime() : 0;
          cmp = pa - pb;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [episodes, sortKey, sortDir, searchQuery]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  function toggleError(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (episodes.length === 0) {
    return <p className="text-muted-foreground">No episodes yet.</p>;
  }

  return (
    <div className="space-y-4">
      <StatsBar episodes={episodes} filteredCount={filteredAndSorted.length} searchQuery={searchQuery} />

      {/* Search input */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search episodes by title or speaker..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
          aria-label="Search episodes by title or speaker"
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

      <div className="flex flex-wrap items-center gap-2">
        <ArrowUpDown size={14} className="text-muted-foreground" />
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => toggleSort(opt.key)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              sortKey === opt.key
                ? "border-foreground/30 bg-accent text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            {opt.label}
            {sortKey === opt.key && (
              <span className="ml-1 inline-block">
                {sortDir === "asc" ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filteredAndSorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No episodes match your search</p>
        ) : (
          filteredAndSorted.map((ep) => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              expandedError={expandedErrors.has(ep.id)}
              onToggleError={toggleError}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { PROCESSING_STEPS };
