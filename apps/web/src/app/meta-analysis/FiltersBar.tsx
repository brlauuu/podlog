"use client";

import type { FilterFeed } from "@/lib/metaAnalysisTypes";

interface Props {
  feeds: FilterFeed[];
  selectedFeedId: string | null;       // null = All podcasts
  onSelectionChange: (id: string | null) => void;
}

export default function FiltersBar({ feeds, selectedFeedId, onSelectionChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 items-center text-sm border rounded-md p-2 bg-muted/30">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Filter
      </span>
      <button
        type="button"
        onClick={() => onSelectionChange(null)}
        className={`px-2 py-1 rounded ${selectedFeedId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
      >
        All podcasts
      </button>
      {feeds.map((f) => (
        <button
          key={f.feed_id}
          type="button"
          onClick={() => onSelectionChange(f.feed_id)}
          className={`px-2 py-1 rounded ${selectedFeedId === f.feed_id ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
        >
          {f.title}
        </button>
      ))}
    </div>
  );
}
