"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";

interface Props {
  episodeId: string;
  speakerLabel: string;
  displayName: string;
  onRenamed: (newName: string) => void;
}

/**
 * Inline editable speaker label for the episode transcript page (PRD-02 §5.4).
 */
export default function SpeakerLabel({ episodeId, speakerLabel, displayName, onRenamed }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim() || value === displayName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker_label: speakerLabel, display_name: value.trim() }),
      });
      if (resp.ok) {
        onRenamed(value.trim());
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="border border-input rounded px-1.5 py-0.5 text-sm bg-background w-32"
        />
        <button onClick={save} disabled={saving} className="text-green-600">
          <Check size={14} />
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground">
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 group">
      <span className="text-sm font-medium">{displayName}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
        title="Rename speaker"
      >
        <Pencil size={12} />
      </button>
    </span>
  );
}
