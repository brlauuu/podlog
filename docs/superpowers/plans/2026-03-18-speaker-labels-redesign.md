# Speaker Labels Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text transcript view with chat bubbles (color-coded per speaker) and add a speaker panel with mini cards for renaming speakers.

**Architecture:** Create a `TranscriptSection` client wrapper that owns segment state and coordinates three children: `SpeakerPanel` (rename UI), `TranscriptView` (chat bubbles), and `TranscriptExportButton`. A shared `speakerColors` utility maps `SPEAKER_NN` labels to a fixed color palette.

**Tech Stack:** Next.js 14, React, Tailwind CSS, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-03-18-speaker-labels-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/lib/speakerColors.ts` | Create | Color palette, initials, and slot-parsing utilities |
| `apps/web/src/components/SpeakerPanel.tsx` | Create | Mini cards grid with inline speaker rename editing |
| `apps/web/src/components/TranscriptView.tsx` | Rewrite | Chat bubble layout with speaker colors |
| `apps/web/src/components/TranscriptSection.tsx` | Create | Client wrapper owning segments state, coordinates panel + transcript + export |
| `apps/web/src/components/SpeakerLabel.tsx` | Delete | Replaced by SpeakerPanel |
| `apps/web/src/app/episodes/[id]/page.tsx` | Modify | Replace inline transcript rendering with single `TranscriptSection` |

---

### Task 1: Speaker color utilities

**Files:**
- Create: `apps/web/src/lib/speakerColors.ts`

This task creates the shared color palette and helper functions used by both the speaker panel and transcript view.

- [ ] **Step 1: Create the speakerColors utility**

Create `apps/web/src/lib/speakerColors.ts`:

```typescript
/**
 * Speaker color palette and utilities for the transcript view.
 * Colors are assigned by speaker slot index (SPEAKER_00 = blue, etc.).
 */

export interface SpeakerColor {
  name: string;
  hex: string;
  bg: string;       // Tailwind-compatible bg tint (rgba)
  border: string;   // Tailwind-compatible border tint (rgba)
}

const PALETTE: SpeakerColor[] = [
  { name: "blue",    hex: "#3b82f6", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.3)" },
  { name: "amber",   hex: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  { name: "emerald", hex: "#10b981", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)" },
  { name: "purple",  hex: "#a855f7", bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.3)" },
  { name: "rose",    hex: "#f43f5e", bg: "rgba(244,63,94,0.1)",  border: "rgba(244,63,94,0.3)" },
];

const SLOT_REGEX = /SPEAKER_(\d+)/;

/**
 * Get the color for a speaker label. Parses the numeric suffix from SPEAKER_NN.
 * Falls back to the last color (rose) for unparseable labels or slots >= 4.
 */
export function getSpeakerColor(speakerLabel: string): SpeakerColor {
  const match = speakerLabel.match(SLOT_REGEX);
  if (!match) return PALETTE[PALETTE.length - 1];
  const index = parseInt(match[1], 10);
  return PALETTE[Math.min(index, PALETTE.length - 1)];
}

/**
 * Get the slot index from a speaker label. Returns -1 for unparseable labels.
 */
export function getSpeakerSlot(speakerLabel: string): number {
  const match = speakerLabel.match(SLOT_REGEX);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * Get initials for a speaker display name.
 * For real names: first letter of each word (e.g., "John Smith" -> "JS").
 * For raw labels: "S" + slot number (e.g., "SPEAKER_00" -> "S0").
 */
export function getSpeakerInitials(displayName: string, speakerLabel: string): string {
  if (displayName === speakerLabel || displayName.startsWith("SPEAKER_")) {
    const slot = getSpeakerSlot(speakerLabel);
    return slot >= 0 ? `S${slot}` : "?";
  }
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}
```

- [ ] **Step 2: Verify the file has no syntax errors**

Run: `cd apps/web && npx tsc --noEmit src/lib/speakerColors.ts 2>&1 || true`

Note: May show import errors from other files — that's fine. We just need no errors in this file itself.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/speakerColors.ts
git commit -m "feat: add speaker color palette and utility functions"
```

---

### Task 2: SpeakerPanel component

**Files:**
- Create: `apps/web/src/components/SpeakerPanel.tsx`

- [ ] **Step 1: Create the SpeakerPanel component**

Create `apps/web/src/components/SpeakerPanel.tsx`:

```typescript
"use client";

import { useState } from "react";
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
      // Use the latest display_name (they should all be the same for a given label)
      if (seg.display_name) existing.displayName = seg.display_name;
    } else {
      map.set(seg.speaker_label, {
        speakerLabel: seg.speaker_label,
        displayName: seg.display_name ?? seg.speaker_label,
        segmentCount: 1,
        inferred: seg.inferred,
        confirmedByUser: seg.confirmed_by_user,
      });
    }
  }
  // Sort by slot index so SPEAKER_00 appears first
  return [...map.values()].sort(
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
      }
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
                <Check size={14} />
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/SpeakerPanel.tsx
git commit -m "feat: add SpeakerPanel component with mini cards and inline editing"
```

---

### Task 3: Rewrite TranscriptView with chat bubbles

**Files:**
- Rewrite: `apps/web/src/components/TranscriptView.tsx`

- [ ] **Step 1: Rewrite TranscriptView.tsx**

Replace the entire contents of `apps/web/src/components/TranscriptView.tsx` with:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { getSpeakerColor, getSpeakerInitials } from "@/lib/speakerColors";

interface Segment {
  id: number;
  start_time: number;
  end_time: number;
  speaker_label: string | null;
  display_name: string | null;
  inferred: boolean;
  confirmed_by_user: boolean;
  text: string;
}

interface Props {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TranscriptView({
  episodeId,
  hasDiarization,
  status,
  segments,
  audioLocalPath,
  episodeTitle,
  feedTitle,
}: Props) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { playEpisode } = useAudioPlayer();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#t-")) {
      const targetId = hash.slice(1);
      const el = document.getElementById(targetId);
      if (el) {
        setHighlightedId(targetId);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

  function handleTimestampClick(startTime: number) {
    if (!audioLocalPath) return;
    const filename = audioLocalPath.split("/").pop() ?? "";
    playEpisode(episodeId, filename, startTime, episodeTitle ?? undefined, feedTitle ?? undefined);
  }

  if (segments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {status === "done" ? "No transcript segments found." : `Processing... (${status})`}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        const segId = `t-${Math.floor(seg.start_time)}`;
        const isHighlighted = segId === highlightedId;
        const prevSpeaker = i > 0 ? segments[i - 1].speaker_label : null;
        const isSpeakerChange = seg.speaker_label !== prevSpeaker;
        const hasSpeaker = hasDiarization && seg.speaker_label;

        if (!hasSpeaker) {
          // No diarization — plain text with timestamp
          return (
            <div
              key={seg.id}
              id={segId}
              className={`flex gap-3 rounded-md py-1 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
            >
              <button
                className="text-xs text-muted-foreground hover:text-primary font-mono shrink-0 mt-0.5 w-14 text-right transition-colors"
                title="Play from here"
                onClick={() => handleTimestampClick(seg.start_time)}
                disabled={!audioLocalPath}
              >
                {formatTime(seg.start_time)}
              </button>
              <p className="text-sm leading-relaxed flex-1">{seg.text}</p>
            </div>
          );
        }

        const color = getSpeakerColor(seg.speaker_label!);
        const displayName = seg.display_name ?? seg.speaker_label!;
        const initials = getSpeakerInitials(displayName, seg.speaker_label!);

        if (isSpeakerChange) {
          // Speaker change — show avatar + name + bubble
          return (
            <div
              key={seg.id}
              id={segId}
              className={`flex gap-3 mt-4 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
            >
              <span
                className="shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5"
                style={{ background: color.hex, width: 32, height: 32 }}
              >
                {initials}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold" style={{ color: color.hex }}>
                    {displayName}
                  </span>
                  <button
                    className="text-xs text-muted-foreground hover:text-primary font-mono transition-colors"
                    title="Play from here"
                    onClick={() => handleTimestampClick(seg.start_time)}
                    disabled={!audioLocalPath}
                  >
                    {formatTime(seg.start_time)}
                  </button>
                </div>
                <div
                  className="text-sm leading-relaxed rounded-b-xl rounded-tr-xl px-3 py-2"
                  style={{ background: color.bg }}
                >
                  {seg.text}
                </div>
              </div>
            </div>
          );
        }

        // Consecutive segment — same speaker, smaller bubble
        return (
          <div
            key={seg.id}
            id={segId}
            className={`flex gap-3 ${isHighlighted ? "border-l-2 border-primary bg-primary/5 pl-2 -ml-2" : ""}`}
          >
            {/* Spacer to align with avatar column */}
            <div className="shrink-0" style={{ width: 32 }} />
            <div className="flex-1 min-w-0">
              <div
                className="text-sm leading-relaxed rounded-xl px-3 py-2"
                style={{ background: color.bg }}
              >
                <button
                  className="text-xs text-muted-foreground hover:text-primary font-mono mr-2 transition-colors"
                  title="Play from here"
                  onClick={() => handleTimestampClick(seg.start_time)}
                  disabled={!audioLocalPath}
                >
                  {formatTime(seg.start_time)}
                </button>
                {seg.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Key changes from the previous version:
- Chat bubble layout with colored avatars and tinted bubbles
- Speaker colors from `speakerColors.ts` utility
- Replaced `path.basename()` (Node.js) with `audioLocalPath.split("/").pop()` (browser-safe)
- Removed `SpeakerLabel` import and inline editing — editing is now in `SpeakerPanel`
- Removed inference badges from segments — they're on the speaker panel cards now
- Segments state is no longer owned here (passed as prop, managed by `TranscriptSection`)

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/TranscriptView.tsx
git commit -m "feat: rewrite TranscriptView with chat bubble layout and speaker colors"
```

---

### Task 4: TranscriptSection client wrapper + episode page integration

**Files:**
- Create: `apps/web/src/components/TranscriptSection.tsx`
- Modify: `apps/web/src/app/episodes/[id]/page.tsx:196-227`
- Delete: `apps/web/src/components/SpeakerLabel.tsx`

- [ ] **Step 1: Create TranscriptSection.tsx**

Create `apps/web/src/components/TranscriptSection.tsx`:

```typescript
"use client";

import { useState } from "react";
import SpeakerPanel from "@/components/SpeakerPanel";
import TranscriptView from "@/components/TranscriptView";
import TranscriptExportButton from "@/components/TranscriptExportButton";

interface Segment {
  id: number;
  start_time: number;
  end_time: number;
  speaker_label: string | null;
  display_name: string | null;
  inferred: boolean;
  confirmed_by_user: boolean;
  text: string;
}

interface Props {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
  // Export-related props
  publishedAt: string | null;
  durationSecs: number | null;
  description: string | null;
  feedUrl: string | null;
  feedWebsiteUrl: string | null;
  feedDescription: string | null;
  audioUrl: string | null;
  guid: string | null;
}

export default function TranscriptSection({
  episodeId,
  hasDiarization,
  status,
  segments: initial,
  audioLocalPath,
  episodeTitle,
  feedTitle,
  publishedAt,
  durationSecs,
  description,
  feedUrl,
  feedWebsiteUrl,
  feedDescription,
  audioUrl,
  guid,
}: Props) {
  const [segments, setSegments] = useState(initial);

  function handleRenamed(speakerLabel: string, newName: string) {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.speaker_label === speakerLabel
          ? { ...seg, display_name: newName, inferred: false, confirmed_by_user: true }
          : seg
      )
    );
  }

  return (
    <div className="space-y-4">
      {/* Transcript header with export */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
        {segments.length > 0 && (
          <TranscriptExportButton
            episodeTitle={episodeTitle ?? "Untitled Episode"}
            feedTitle={feedTitle}
            publishedAt={publishedAt}
            durationSecs={durationSecs}
            description={description}
            feedUrl={feedUrl}
            feedWebsiteUrl={feedWebsiteUrl}
            feedDescription={feedDescription}
            audioUrl={audioUrl}
            guid={guid}
            segments={segments}
          />
        )}
      </div>

      {/* Speaker panel */}
      {hasDiarization && (
        <SpeakerPanel
          episodeId={episodeId}
          segments={segments}
          onRenamed={handleRenamed}
        />
      )}

      {/* Transcript */}
      <TranscriptView
        episodeId={episodeId}
        hasDiarization={hasDiarization}
        status={status}
        segments={segments}
        audioLocalPath={audioLocalPath}
        episodeTitle={episodeTitle}
        feedTitle={feedTitle}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update the episode page to use TranscriptSection**

In `apps/web/src/app/episodes/[id]/page.tsx`, make these changes:

**Replace the import** of `TranscriptView` and `TranscriptExportButton` (lines 8, 10):

Change:
```typescript
import TranscriptView from "@/components/TranscriptView";
import TranscriptExportButton from "@/components/TranscriptExportButton";
```

To:
```typescript
import TranscriptSection from "@/components/TranscriptSection";
```

**Replace the Separator, transcript header, export button, and TranscriptView** (lines 196-227) with a single `TranscriptSection`:

Replace:
```tsx
      <Separator />

      {/* Transcript header with export */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
        {segments.length > 0 && (
          <TranscriptExportButton
            episodeTitle={episode.title ?? "Untitled Episode"}
            feedTitle={episode.feed_title}
            publishedAt={episode.published_at}
            durationSecs={episode.duration_secs}
            description={episode.description}
            feedUrl={episode.feed_url}
            feedWebsiteUrl={episode.feed_website_url}
            feedDescription={episode.feed_description}
            audioUrl={episode.audio_url}
            guid={episode.guid}
            segments={segments}
          />
        )}
      </div>

      {/* Transcript — PRD-04 §8.1: inferred/confirmed badges on speaker labels */}
      <TranscriptView
        episodeId={episode.id}
        hasDiarization={episode.has_diarization}
        status={episode.status}
        segments={segments}
        audioLocalPath={episode.audio_local_path}
        episodeTitle={episode.title}
        feedTitle={episode.feed_title}
      />
```

With:
```tsx
      <Separator />

      <TranscriptSection
        episodeId={episode.id}
        hasDiarization={episode.has_diarization}
        status={episode.status}
        segments={segments}
        audioLocalPath={episode.audio_local_path}
        episodeTitle={episode.title}
        feedTitle={episode.feed_title}
        publishedAt={episode.published_at}
        durationSecs={episode.duration_secs}
        description={episode.description}
        feedUrl={episode.feed_url}
        feedWebsiteUrl={episode.feed_website_url}
        feedDescription={episode.feed_description}
        audioUrl={episode.audio_url}
        guid={episode.guid}
      />
```

- [ ] **Step 3: Delete SpeakerLabel.tsx**

```bash
rm apps/web/src/components/SpeakerLabel.tsx
```

- [ ] **Step 4: Verify no remaining imports of SpeakerLabel**

Run: `grep -r "SpeakerLabel" apps/web/src/`

Expected: No results. If any files still import `SpeakerLabel`, remove those imports.

- [ ] **Step 5: Verify the app builds**

Run: `cd apps/web && npx next build 2>&1 | tail -20`

Expected: Build succeeds with no errors. (Warnings about unused vars are OK.)

Note: If the build environment lacks `DATABASE_URL`, you can verify with `npx tsc --noEmit` instead, which only checks types without needing a DB connection.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/TranscriptSection.tsx apps/web/src/app/episodes/\[id\]/page.tsx
git rm apps/web/src/components/SpeakerLabel.tsx
git commit -m "feat: add TranscriptSection wrapper, integrate speaker panel, remove SpeakerLabel"
```

---

### Task 5: Visual smoke test

This task validates the full experience end-to-end.

- [ ] **Step 1: Rebuild and restart**

Run: `make build && make up`

- [ ] **Step 2: Open an episode with diarization**

Open http://localhost:3000 in a browser, navigate to a completed episode that has speaker labels. Verify:
- Speaker panel shows above the transcript with mini cards (one per speaker)
- Transcript uses chat bubble layout with colored avatars
- Consecutive segments by same speaker are grouped (no avatar, smaller bubble)
- Clicking a timestamp plays audio from that point

- [ ] **Step 3: Test speaker rename**

Click a speaker card in the panel. Verify:
- Name becomes an editable input
- Type a new name, press Enter
- The panel card, all transcript bubbles, and the avatar initials update immediately
- The inference badge changes to "Confirmed"

- [ ] **Step 4: Test export after rename**

Click the Export button after renaming a speaker. Open the downloaded .txt file and verify the renamed speaker name appears in the transcript text.
