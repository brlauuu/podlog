"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

interface Feed {
  id: string;
  title: string | null;
  episode_count: number;
}

interface PodcastFilterProps {
  feeds: Feed[];
  selectedFeedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  hasManualUploads?: boolean;
}

export default function PodcastFilter({
  feeds,
  selectedFeedIds,
  onSelectionChange,
  hasManualUploads = false,
}: PodcastFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (feeds.length === 0 && !hasManualUploads) return null;

  function toggle(id: string) {
    const next = new Set(selectedFeedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm border border-input rounded-md px-2 py-1 bg-background text-foreground hover:bg-accent/30 transition-colors"
      >
        <span className="text-muted-foreground">Source:</span>
        {selectedFeedIds.size === 0
          ? "All"
          : `${selectedFeedIds.size} selected`}
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[220px] max-h-64 overflow-y-auto">
          <button
            type="button"
            onClick={() => onSelectionChange(new Set())}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors ${
              selectedFeedIds.size === 0 ? "font-medium" : ""
            }`}
          >
            All sources
          </button>
          <div className="border-t border-border my-1" />
          {feeds.map((f) => (
            <label
              key={f.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedFeedIds.has(f.id)}
                onChange={() => toggle(f.id)}
                className="rounded"
              />
              <span className="truncate">{f.title || "Untitled"}</span>
            </label>
          ))}
          {hasManualUploads && (
            <>
              <div className="border-t border-border my-1" />
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedFeedIds.has("__uploads__")}
                  onChange={() => toggle("__uploads__")}
                  className="rounded"
                />
                <span>Manual uploads</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
