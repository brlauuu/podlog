"use client";

import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import { getSpeakerColor, getSpeakerInitials, getSpeakerSlot } from "@/lib/speakerColors";
import type { Segment, SpeakerRole } from "@/lib/types";
import MergeBar from "@/components/MergeBar";

interface SpeakerInfo {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  inferred: boolean;
  confirmedByUser: boolean;
  /** #698: user-assigned role for this speaker on this episode. */
  role: SpeakerRole | null;
}

// #698: sort key per role. Hosts first, then guests, then others, then
// unassigned. Non-role tie-break uses the speaker slot (existing behavior).
const ROLE_ORDER: Record<string, number> = {
  host: 0,
  guest: 1,
  other: 2,
};
const UNASSIGNED_ROLE_ORDER = 3;

function roleSortKey(role: SpeakerRole | null): number {
  return role === null ? UNASSIGNED_ROLE_ORDER : ROLE_ORDER[role];
}

interface Props {
  episodeId: string;
  segments: Segment[];
  onRenamed: (speakerLabel: string, newName: string) => void;
  onMerged: (sourceLabels: string[], targetLabel: string) => void;
  activeSpeaker: string | null;
  onFilterSpeaker: (speakerLabel: string | null) => void;
  /** #698: called after a role change is persisted, so the parent can
   *  update its segment cache without a full refetch. */
  onRoleChanged?: (speakerLabel: string, role: SpeakerRole | null) => void;
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
      // #698: a non-null role on any segment wins (every segment for a label
      // shares the same role row, so this is just a "use whichever segment
      // brought the data" guard).
      if (seg.role && !existing.role) existing.role = seg.role;
    } else {
      map.set(seg.speaker_label, {
        speakerLabel: seg.speaker_label,
        displayName: seg.display_name || seg.speaker_label,
        segmentCount: 1,
        inferred: seg.inferred,
        confirmedByUser: seg.confirmed_by_user,
        role: seg.role ?? null,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const roleDiff = roleSortKey(a.role) - roleSortKey(b.role);
    if (roleDiff !== 0) return roleDiff;
    return getSpeakerSlot(a.speakerLabel) - getSpeakerSlot(b.speakerLabel);
  });
}

function SpeakerCard({
  speaker,
  episodeId,
  onRenamed,
  onRoleChanged,
  mergeMode,
  selected,
  onToggleSelect,
  active,
  onFilter,
}: {
  speaker: SpeakerInfo;
  episodeId: string;
  onRenamed: (newName: string) => void;
  onRoleChanged?: (role: SpeakerRole | null) => void;
  mergeMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  active: boolean;
  onFilter: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(speaker.displayName);
  const [saving, setSaving] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  useEffect(() => {
    if (!editing) setValue(speaker.displayName);
  }, [speaker.displayName, editing]);

  const color = getSpeakerColor(speaker.speakerLabel);
  const initials = getSpeakerInitials(speaker.displayName, speaker.speakerLabel);
  const isInferredUnconfirmed = speaker.inferred && !speaker.confirmedByUser;

  async function persistDisplayName(trimmed: string) {
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

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setValue(speaker.displayName);
      setEditing(false);
      return;
    }

    // Allow explicit confirmation without forcing users to edit unchanged inferred names.
    if (trimmed === speaker.displayName && !isInferredUnconfirmed) {
      setEditing(false);
      return;
    }

    await persistDisplayName(trimmed);
  }

  async function confirmInferredName() {
    const trimmed = speaker.displayName.trim();
    if (!trimmed || saving) return;
    await persistDisplayName(trimmed);
  }

  async function persistRole(nextRole: SpeakerRole | null) {
    if (savingRole) return;
    // Toggle: clicking the active role clears it.
    const target = speaker.role === nextRole ? null : nextRole;
    setSavingRole(true);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker_label: speaker.speakerLabel,
          display_name: speaker.displayName,
          role: target,
        }),
      });
      if (resp.ok) onRoleChanged?.(target);
    } finally {
      setSavingRole(false);
    }
  }

  return (
    <div
      className={`relative rounded-lg p-3 transition-colors ${mergeMode ? "cursor-pointer hover:brightness-110" : "cursor-default"} ${mergeMode && selected ? "ring-2 ring-indigo-500" : ""} ${active ? "ring-2 ring-primary" : ""}`}
      style={{ background: color.bg, border: `1px solid ${color.border}` }}
      onClick={() => { if (mergeMode) onToggleSelect(); }}
    >
      {mergeMode && (
        <div
          className={`absolute top-1 left-1 w-4 h-4 rounded border-2 flex items-center justify-center text-[10px] ${
            selected
              ? "bg-indigo-500 border-indigo-500 text-white"
              : "border-indigo-400 bg-transparent"
          }`}
        >
          {selected && "✓"}
        </div>
      )}
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
            {/* #698: badge reflects the user-assigned role, not a label-slot guess. */}
            {speaker.role && (
              <span
                className="text-[10px] px-1.5 py-0 rounded capitalize"
                style={{ background: color.bg, color: color.hex }}
              >
                {speaker.role}
              </span>
            )}
            {isInferredUnconfirmed && (
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
          {!mergeMode && !editing && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {/* #698: role selector — click to set, click again to clear. */}
              {(["host", "guest", "other"] as const).map((r) => {
                const isActive = speaker.role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void persistRole(r);
                    }}
                    disabled={savingRole}
                    aria-pressed={isActive}
                    aria-label={`${isActive ? "Clear" : "Set"} role ${r} for ${speaker.displayName}`}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors capitalize disabled:opacity-50 ${
                      isActive
                        ? "border-foreground bg-foreground text-background"
                        : "border-input text-muted-foreground hover:text-foreground hover:bg-background"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                className="text-[10px] px-2 py-0.5 rounded border border-input text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                aria-label={`Edit ${speaker.displayName}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter();
                }}
                className="text-[10px] px-2 py-0.5 rounded border border-input text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                aria-label={`${active ? "Hide" : "Show"} segments for ${speaker.displayName}`}
              >
                {active ? "Hide segments" : "Show segments"}
              </button>
              {isInferredUnconfirmed && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void confirmInferredName();
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-green-300 text-green-700 dark:text-green-300 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                  aria-label={`Confirm ${speaker.displayName}`}
                >
                  Confirm
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SpeakerPanel({ episodeId, segments, onRenamed, onMerged, activeSpeaker, onFilterSpeaker, onRoleChanged }: Props) {
  const speakers = deriveSpeakers(segments);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  if (speakers.length === 0) return null;

  function toggleSelection(label: string) {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function exitMergeMode() {
    setMergeMode(false);
    setSelectedLabels(new Set());
    setMerging(false);
    setMergeError(null);
  }

  async function handleMerge(targetLabel: string) {
    const sourceLabels = Array.from(selectedLabels).filter((l) => l !== targetLabel);
    if (sourceLabels.length === 0) return;
    setMerging(true);
    setMergeError(null);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/speakers/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_labels: sourceLabels, target_label: targetLabel }),
      });
      if (resp.ok) {
        onMerged(sourceLabels, targetLabel);
        exitMergeMode();
      } else {
        const data = await resp.json().catch(() => ({}));
        setMergeError(data.error || "Merge failed");
      }
    } catch {
      setMergeError("Merge failed — check your connection");
    } finally {
      setMerging(false);
    }
  }

  const selectedSpeakers = speakers.filter((s) => selectedLabels.has(s.speakerLabel));

  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Speakers</div>
          {!mergeMode && (
            <div className="text-[10px] text-muted-foreground/60">
              Use action buttons to edit and show/hide segments
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeSpeaker && !mergeMode && (
            <button
              onClick={() => onFilterSpeaker(null)}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Show all
            </button>
          )}
          {speakers.length >= 2 && (
            <button
              onClick={() => (mergeMode ? exitMergeMode() : setMergeMode(true))}
              className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
            >
              {mergeMode ? "Cancel merge" : "Merge speakers"}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(speakers.length, 4)}, 1fr)` }}>
        {speakers.map((speaker) => (
          <SpeakerCard
            key={speaker.speakerLabel}
            speaker={speaker}
            episodeId={episodeId}
            onRenamed={(newName) => onRenamed(speaker.speakerLabel, newName)}
            onRoleChanged={(role) => onRoleChanged?.(speaker.speakerLabel, role)}
            mergeMode={mergeMode}
            selected={selectedLabels.has(speaker.speakerLabel)}
            onToggleSelect={() => toggleSelection(speaker.speakerLabel)}
            active={activeSpeaker === speaker.speakerLabel}
            onFilter={() => onFilterSpeaker(activeSpeaker === speaker.speakerLabel ? null : speaker.speakerLabel)}
          />
        ))}
      </div>
      {mergeMode && selectedSpeakers.length >= 2 && (
        <MergeBar
          selectedSpeakers={selectedSpeakers}
          onMerge={handleMerge}
          onCancel={exitMergeMode}
          merging={merging}
        />
      )}
      {mergeError && (
        <div className="mt-2 text-xs text-red-500">{mergeError}</div>
      )}
    </div>
  );
}
