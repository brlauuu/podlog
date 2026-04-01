"use client";

import { useState, useEffect } from "react";

interface SpeakerInfo {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  inferred: boolean;
  confirmedByUser: boolean;
}

interface Props {
  selectedSpeakers: SpeakerInfo[];
  onMerge: (targetLabel: string) => void;
  onCancel: () => void;
  merging: boolean;
}

export default function MergeBar({ selectedSpeakers, onMerge, onCancel, merging }: Props) {
  // Default to speaker with most segments, reset when selection changes
  const sorted = [...selectedSpeakers].sort((a, b) => b.segmentCount - a.segmentCount);
  const [targetLabel, setTargetLabel] = useState(sorted[0]?.speakerLabel ?? "");

  const selectionKey = selectedSpeakers.map((s) => s.speakerLabel).sort().join(",");
  useEffect(() => {
    setTargetLabel(sorted[0]?.speakerLabel ?? "");
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white mt-2">
      <span>
        Merge {selectedSpeakers.length} speakers into:
      </span>
      <select
        role="combobox"
        value={targetLabel}
        onChange={(e) => setTargetLabel(e.target.value)}
        className="rounded px-2 py-1 text-sm bg-indigo-700 text-white border border-indigo-500 focus:outline-none focus:ring-1 focus:ring-white"
      >
        {sorted.map((s) => (
          <option key={s.speakerLabel} value={s.speakerLabel}>
            {s.displayName} ({s.segmentCount} segments)
          </option>
        ))}
      </select>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onMerge(targetLabel)}
          disabled={merging}
          className="rounded bg-white px-3 py-1 text-sm font-semibold text-indigo-600 disabled:opacity-50"
        >
          {merging ? "Merging..." : "Merge"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-indigo-200 underline hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
