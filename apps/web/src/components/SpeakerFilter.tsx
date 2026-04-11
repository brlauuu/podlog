"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, User } from "lucide-react";

interface Speaker {
  speaker_label: string;
  display_name: string;
}

interface SpeakerFilterProps {
  feedIds: string[];
  includeManualUploads: boolean;
  selectedSpeaker: string | null;
  onSelectionChange: (speaker: string | null) => void;
}

export default function SpeakerFilter({
  feedIds,
  includeManualUploads,
  selectedSpeaker,
  onSelectionChange,
}: SpeakerFilterProps) {
  const [open, setOpen] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    const realIds = feedIds.filter((id) => id !== "__uploads__");
    if (realIds.length > 0) params.set("feedId", realIds.join(","));
    if (includeManualUploads) params.set("uploads", "true");

    fetch(`/api/search/speakers?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSpeakers(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [feedIds, includeManualUploads]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (loading || speakers.length === 0) return null;

  const selectedDisplay = selectedSpeaker
    ? (speakers.find((s) => s.speaker_label === selectedSpeaker)?.display_name ?? selectedSpeaker)
    : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm border border-input rounded-md px-2 py-1 bg-background text-foreground hover:bg-accent/30 transition-colors"
      >
        <User size={13} className="text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Speaker:</span>
        <span className={selectedDisplay ? "max-w-[120px] truncate" : ""}>
          {selectedDisplay ?? "All"}
        </span>
        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[200px] max-h-64 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onSelectionChange(null); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors ${
              !selectedSpeaker ? "font-medium" : ""
            }`}
          >
            All speakers
          </button>
          <div className="border-t border-border my-1" />
          {speakers.map((s) => (
            <button
              key={s.speaker_label}
              type="button"
              onClick={() => { onSelectionChange(s.speaker_label); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors truncate ${
                selectedSpeaker === s.speaker_label ? "font-medium" : ""
              }`}
            >
              {s.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
