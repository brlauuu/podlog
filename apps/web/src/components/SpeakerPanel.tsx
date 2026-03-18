"use client";

import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import { getSpeakerColor, getSpeakerInitials, getSpeakerSlot } from "@/lib/speakerColors";

interface Segment {
  speaker_label: string | null;
  display_name: string | null;
  inferred: boolean;
  confirmed_by_user: boolean;
}

interface SpeakerInfo {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  inferred: boolean;
  confirmedByUser: boolean;
}

interface Props {
  episodeId: string;
  segments: Segment[];
  onRenamed: (speakerLabel: string, newName: string) => void;
}

function deriveSpeakers(segments: Segment[]): SpeakerInfo[] {
  const map = new Map<string, SpeakerInfo>();
  for (const seg of segments) {
    if (!seg.speaker_label) continue;
    const existing = map.get(seg.speaker_label);
    if (existing) {
      existing.segmentCount++;
      if (seg.display_name) existing.displayName = seg.display_name;
      if (seg.inferred && !existing.confirmedByUser) existing.inferred = true;
      if (seg.confirmed_by_user) {
        existing.confirmedByUser = true;
        existing.inferred = false;
      }
    } else {
      map.set(seg.speaker_label, {
        speakerLabel: seg.speaker_label,
        displayName: seg.display_name || seg.speaker_label,
        segmentCount: 1,
        inferred: seg.inferred,
        confirmedByUser: seg.confirmed_by_user,
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => getSpeakerSlot(a.speakerLabel) - getSpeakerSlot(b.speakerLabel)
  );
}

function SpeakerCard({
  speaker,
  episodeId,
  onRenamed,
}: {
  speaker: SpeakerInfo;
  episodeId: string;
  onRenamed: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(speaker.displayName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setValue(speaker.displayName);
  }, [speaker.displayName, editing]);

  const color = getSpeakerColor(speaker.speakerLabel);
  const initials = getSpeakerInitials(speaker.displayName, speaker.speakerLabel);
  const slot = getSpeakerSlot(speaker.speakerLabel);
  const hasCustomName = speaker.displayName !== speaker.speakerLabel;

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === speaker.displayName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker_label: speaker.speakerLabel, display_name: trimmed }),
      });
      if (resp.ok) {
        onRenamed(trimmed);
        setEditing(false);
      } else {
        setValue(speaker.displayName);
        setEditing(false);
      }
    } catch {
      setValue(speaker.displayName);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-lg p-3 cursor-pointer transition-colors ${editing ? "" : "hover:brightness-110"}`}
      style={{ background: color.bg, border: `1px solid ${color.border}` }}
      onClick={() => { if (!editing) setEditing(true); }}
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold"
          style={{ background: color.hex, width: 28, height: 28 }}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") { setValue(speaker.displayName); setEditing(false); }
                }}
                onClick={(e) => e.stopPropagation()}
                disabled={saving}
                className="border border-input rounded px-1.5 py-0.5 text-sm bg-background w-full min-w-0"
              />
              <button onClick={(e) => { e.stopPropagation(); save(); }} disabled={saving} className="text-green-600 shrink-0">
                {saving ? <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" /> : <Check size={14} />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setValue(speaker.displayName); setEditing(false); }} className="text-muted-foreground shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="text-sm font-semibold truncate" style={{ color: color.hex }}>
              {speaker.displayName}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {hasCustomName && (
              <span
                className="text-[10px] px-1.5 py-0 rounded"
                style={{ background: color.bg, color: color.hex }}
              >
                {slot === 0 ? "Host" : "Guest"}
              </span>
            )}
            {speaker.inferred && !speaker.confirmedByUser && (
              <span className="text-[10px] px-1.5 py-0 rounded bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300">
                Inferred
              </span>
            )}
            {speaker.confirmedByUser && (
              <span className="text-[10px] px-1.5 py-0 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                &#10003; Confirmed
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {speaker.segmentCount} segment{speaker.segmentCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SpeakerPanel({ episodeId, segments, onRenamed }: Props) {
  const speakers = deriveSpeakers(segments);

  if (speakers.length === 0) return null;

  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Speakers</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(speakers.length, 4)}, 1fr)` }}>
        {speakers.map((speaker) => (
          <SpeakerCard
            key={speaker.speakerLabel}
            speaker={speaker}
            episodeId={episodeId}
            onRenamed={(newName) => onRenamed(speaker.speakerLabel, newName)}
          />
        ))}
      </div>
    </div>
  );
}
