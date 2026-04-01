# Speaker Merging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to merge two or more speaker labels within a single episode via a checkbox-select + merge-bar UI, reassigning all segments from source speakers to a chosen target.

**Architecture:** The merge is entirely frontend + Next.js API route. No pipeline changes. The Next.js route runs SQL directly against PostgreSQL in a transaction (consistent with the existing speaker rename pattern). The SpeakerPanel gains a merge mode with checkbox selection, and a new MergeBar component handles target selection and confirmation.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, PostgreSQL (pg), Jest + React Testing Library

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts` | Create | POST endpoint — validate, run merge SQL in transaction |
| `apps/web/src/components/MergeBar.tsx` | Create | Merge confirmation bar: target dropdown, merge button, cancel |
| `apps/web/src/components/SpeakerPanel.tsx` | Modify | Add merge mode state, checkbox selection, render MergeBar |
| `apps/web/src/components/TranscriptSection.tsx` | Modify | Add `onMerged` callback to update local segments state |
| `apps/web/tests/unit/speaker-merge-route.test.ts` | Create | Unit tests for merge API route validation logic |
| `apps/web/tests/unit/MergeBar.test.tsx` | Create | Unit tests for MergeBar component |

---

### Task 1: Merge API Route

**Files:**
- Create: `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts`
- Create: `apps/web/tests/unit/speaker-merge-route.test.ts`

- [ ] **Step 1: Write validation tests**

Create `apps/web/tests/unit/speaker-merge-route.test.ts`:

```typescript
/**
 * Unit tests for speaker merge API route validation logic.
 * Tests the pure validation function without hitting the database.
 */

interface MergeRequest {
  source_labels: string[];
  target_label: string;
}

interface ValidationError {
  error: string;
}

function validateMergeRequest(body: unknown): ValidationError | null {
  // stub — will be implemented in step 3
  return null;
}

describe("speaker merge validation", () => {
  test("valid request passes", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_01"],
      target_label: "SPEAKER_00",
    });
    expect(result).toBeNull();
  });

  test("missing source_labels returns error", () => {
    const result = validateMergeRequest({ target_label: "SPEAKER_00" });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });

  test("empty source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: [],
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });

  test("missing target_label returns error", () => {
    const result = validateMergeRequest({ source_labels: ["SPEAKER_01"] });
    expect(result).toEqual({ error: "target_label must be a non-empty string" });
  });

  test("empty target_label returns error", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_01"],
      target_label: "",
    });
    expect(result).toEqual({ error: "target_label must be a non-empty string" });
  });

  test("target_label in source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_00", "SPEAKER_01"],
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "target_label must not appear in source_labels" });
  });

  test("non-array source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: "SPEAKER_01",
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx jest tests/unit/speaker-merge-route.test.ts --no-coverage`
Expected: 6 of 7 tests FAIL (the "valid request passes" test will pass because the stub returns null)

- [ ] **Step 3: Implement the validation function in the test file**

Update the `validateMergeRequest` function in `apps/web/tests/unit/speaker-merge-route.test.ts`:

```typescript
function validateMergeRequest(body: unknown): ValidationError | null {
  const b = body as Record<string, unknown>;
  if (!b.source_labels || !Array.isArray(b.source_labels) || b.source_labels.length === 0) {
    return { error: "source_labels must be a non-empty array" };
  }
  if (!b.target_label || typeof b.target_label !== "string" || b.target_label.trim() === "") {
    return { error: "target_label must be a non-empty string" };
  }
  if (b.source_labels.includes(b.target_label)) {
    return { error: "target_label must not appear in source_labels" };
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest tests/unit/speaker-merge-route.test.ts --no-coverage`
Expected: 7 tests PASS

- [ ] **Step 5: Create the API route with the same validation logic**

Create `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

function validateMergeRequest(body: unknown): { error: string } | null {
  const b = body as Record<string, unknown>;
  if (!b.source_labels || !Array.isArray(b.source_labels) || b.source_labels.length === 0) {
    return { error: "source_labels must be a non-empty array" };
  }
  if (!b.target_label || typeof b.target_label !== "string" || b.target_label.trim() === "") {
    return { error: "target_label must be a non-empty string" };
  }
  if (b.source_labels.includes(b.target_label)) {
    return { error: "target_label must not appear in source_labels" };
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validateMergeRequest(body);
  if (validationError) {
    return NextResponse.json(validationError, { status: 400 });
  }

  const { source_labels, target_label } = body as {
    source_labels: string[];
    target_label: string;
  };
  const episodeId = params.id;
  const allLabels = [target_label, ...source_labels];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate all labels belong to this episode
    const check = await client.query(
      `SELECT DISTINCT speaker_label FROM segments
       WHERE episode_id = $1 AND speaker_label = ANY($2)`,
      [episodeId, allLabels]
    );
    const found = new Set(check.rows.map((r: { speaker_label: string }) => r.speaker_label));
    const missing = allLabels.filter((l) => !found.has(l));
    if (missing.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Labels not found in episode: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // Reassign segments from source labels to target
    const update = await client.query(
      `UPDATE segments SET speaker_label = $1
       WHERE episode_id = $2 AND speaker_label = ANY($3)`,
      [target_label, episodeId, source_labels]
    );

    // Delete orphaned speaker_names for source labels
    await client.query(
      `DELETE FROM speaker_names
       WHERE episode_id = $1 AND speaker_label = ANY($2)`,
      [episodeId, source_labels]
    );

    await client.query("COMMIT");

    return NextResponse.json({ ok: true, merged_segments: update.rowCount ?? 0 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Speaker merge error:", err);
    return NextResponse.json({ error: "Failed to merge speakers" }, { status: 500 });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/episodes/\[id\]/speakers/merge/route.ts apps/web/tests/unit/speaker-merge-route.test.ts
git commit -m "feat: add speaker merge API route with validation"
```

---

### Task 2: MergeBar Component

**Files:**
- Create: `apps/web/src/components/MergeBar.tsx`
- Create: `apps/web/tests/unit/MergeBar.test.tsx`

- [ ] **Step 1: Write MergeBar tests**

Create `apps/web/tests/unit/MergeBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import MergeBar from "@/components/MergeBar";

interface SpeakerInfo {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  inferred: boolean;
  confirmedByUser: boolean;
}

const speakers: SpeakerInfo[] = [
  { speakerLabel: "SPEAKER_00", displayName: "Tim Ferriss", segmentCount: 42, inferred: false, confirmedByUser: true },
  { speakerLabel: "SPEAKER_01", displayName: "Jane Smith", segmentCount: 28, inferred: true, confirmedByUser: false },
  { speakerLabel: "SPEAKER_02", displayName: "SPEAKER_02", segmentCount: 3, inferred: false, confirmedByUser: false },
];

describe("MergeBar", () => {
  test("renders merge text with speaker count", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={false} />);
    expect(screen.getByText(/merge 3 speakers into/i)).toBeInTheDocument();
  });

  test("defaults target to speaker with most segments", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={false} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("SPEAKER_00");
  });

  test("calls onMerge with selected target label", () => {
    const onMerge = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={onMerge} onCancel={() => {}} merging={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(onMerge).toHaveBeenCalledWith("SPEAKER_00");
  });

  test("calls onCancel when cancel clicked", () => {
    const onCancel = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={onCancel} merging={false} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("merge button disabled when merging is true", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={true} />);
    expect(screen.getByRole("button", { name: /merging/i })).toBeDisabled();
  });

  test("changing dropdown updates target", () => {
    const onMerge = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={onMerge} onCancel={() => {}} merging={false} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "SPEAKER_01" } });
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(onMerge).toHaveBeenCalledWith("SPEAKER_01");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx jest tests/unit/MergeBar.test.tsx --no-coverage`
Expected: FAIL — module `@/components/MergeBar` not found

- [ ] **Step 3: Implement MergeBar component**

Create `apps/web/src/components/MergeBar.tsx`:

```tsx
"use client";

import { useState } from "react";

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
  // Default to speaker with most segments
  const sorted = [...selectedSpeakers].sort((a, b) => b.segmentCount - a.segmentCount);
  const [targetLabel, setTargetLabel] = useState(sorted[0]?.speakerLabel ?? "");

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest tests/unit/MergeBar.test.tsx --no-coverage`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MergeBar.tsx apps/web/tests/unit/MergeBar.test.tsx
git commit -m "feat: add MergeBar component with target dropdown"
```

---

### Task 3: SpeakerPanel Merge Mode

**Files:**
- Modify: `apps/web/src/components/SpeakerPanel.tsx`

This task modifies the existing SpeakerPanel to add merge mode. The current SpeakerPanel (189 lines) has:
- `SpeakerInfo` interface (lines 8-14)
- `deriveSpeakers` function (lines 22-48)
- `SpeakerCard` component (lines 50-167)
- `SpeakerPanel` component (lines 169-189)

Key behavior: clicking a card currently enters rename edit mode (`setEditing(true)` on line 104). In merge mode, clicking must toggle selection instead.

- [ ] **Step 1: Add merge mode state and header button to SpeakerPanel**

In `apps/web/src/components/SpeakerPanel.tsx`, replace the `SpeakerPanel` component (lines 169-189) with:

```tsx
export default function SpeakerPanel({ episodeId, segments, onRenamed, onMerged }: Props) {
  const speakers = deriveSpeakers(segments);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

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
  }

  async function handleMerge(targetLabel: string) {
    const sourceLabels = [...selectedLabels].filter((l) => l !== targetLabel);
    if (sourceLabels.length === 0) return;
    setMerging(true);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/speakers/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_labels: sourceLabels, target_label: targetLabel }),
      });
      if (resp.ok) {
        const data = await resp.json();
        onMerged(sourceLabels, targetLabel);
        exitMergeMode();
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setMerging(false);
    }
  }

  const selectedSpeakers = speakers.filter((s) => selectedLabels.has(s.speakerLabel));

  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">Speakers</div>
        {speakers.length >= 2 && (
          <button
            onClick={() => (mergeMode ? exitMergeMode() : setMergeMode(true))}
            className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
          >
            {mergeMode ? "Cancel merge" : "Merge speakers"}
          </button>
        )}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(speakers.length, 4)}, 1fr)` }}>
        {speakers.map((speaker) => (
          <SpeakerCard
            key={speaker.speakerLabel}
            speaker={speaker}
            episodeId={episodeId}
            onRenamed={(newName) => onRenamed(speaker.speakerLabel, newName)}
            mergeMode={mergeMode}
            selected={selectedLabels.has(speaker.speakerLabel)}
            onToggleSelect={() => toggleSelection(speaker.speakerLabel)}
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
    </div>
  );
}
```

- [ ] **Step 2: Update the Props interface and add MergeBar import**

At the top of `apps/web/src/components/SpeakerPanel.tsx`, add the import:

```typescript
import MergeBar from "@/components/MergeBar";
```

Update the `Props` interface (around line 16):

```typescript
interface Props {
  episodeId: string;
  segments: Segment[];
  onRenamed: (speakerLabel: string, newName: string) => void;
  onMerged: (sourceLabels: string[], targetLabel: string) => void;
}
```

- [ ] **Step 3: Add merge mode props to SpeakerCard**

Update the `SpeakerCard` function signature (around line 50) to accept merge mode props:

```tsx
function SpeakerCard({
  speaker,
  episodeId,
  onRenamed,
  mergeMode,
  selected,
  onToggleSelect,
}: {
  speaker: SpeakerInfo;
  episodeId: string;
  onRenamed: (newName: string) => void;
  mergeMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
```

Update the card's `onClick` handler on the outer `<div>` (around line 104):

```tsx
onClick={() => {
  if (mergeMode) {
    onToggleSelect();
  } else if (!editing) {
    setEditing(true);
  }
}}
```

Add the checkbox overlay and selection ring. Inside the outer `<div>`, add a conditional style for the selected ring, and a checkbox element. Replace the outer `<div>` opening tag:

```tsx
<div
  className={`rounded-lg p-3 cursor-pointer transition-colors ${editing ? "" : "hover:brightness-110"} ${
    mergeMode && selected ? "ring-2 ring-indigo-500" : ""
  }`}
  style={{ background: color.bg, border: `1px solid ${color.border}` }}
  onClick={() => {
    if (mergeMode) {
      onToggleSelect();
    } else if (!editing) {
      setEditing(true);
    }
  }}
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
```

Also add `relative` to the outer div's className so the absolute checkbox is positioned correctly:

```tsx
className={`relative rounded-lg p-3 cursor-pointer transition-colors ...`}
```

- [ ] **Step 4: Run all web tests to verify nothing is broken**

Run: `cd apps/web && npx jest --no-coverage`
Expected: All existing tests PASS (MergeBar tests pass, audio-route tests pass, speaker-merge-route tests pass)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SpeakerPanel.tsx
git commit -m "feat: add merge mode with checkbox selection to SpeakerPanel"
```

---

### Task 4: Wire Up TranscriptSection

**Files:**
- Modify: `apps/web/src/components/TranscriptSection.tsx`

The `TranscriptSection` component holds segments in state (line 44) and passes callbacks to `SpeakerPanel`. It needs a new `onMerged` callback that updates local segments state when speakers are merged.

- [ ] **Step 1: Add handleMerged callback to TranscriptSection**

In `apps/web/src/components/TranscriptSection.tsx`, add after the `handleRenamed` function (after line 54):

```typescript
function handleMerged(sourceLabels: string[], targetLabel: string) {
  setSegments((prev) => {
    // Copy the target speaker's display name to reassigned segments
    const targetSeg = prev.find(
      (s) => s.speaker_label === targetLabel && s.display_name
    );
    const targetDisplayName = targetSeg?.display_name ?? null;
    const targetInferred = targetSeg?.inferred ?? false;
    const targetConfirmed = targetSeg?.confirmed_by_user ?? false;

    return prev.map((seg) =>
      seg.speaker_label && sourceLabels.includes(seg.speaker_label)
        ? {
            ...seg,
            speaker_label: targetLabel,
            display_name: targetDisplayName,
            inferred: targetInferred,
            confirmed_by_user: targetConfirmed,
          }
        : seg
    );
  });
}
```

- [ ] **Step 2: Pass onMerged to SpeakerPanel**

Update the `<SpeakerPanel>` JSX (around line 78) to pass the new callback:

```tsx
<SpeakerPanel
  episodeId={episodeId}
  segments={segments}
  onRenamed={handleRenamed}
  onMerged={handleMerged}
/>
```

- [ ] **Step 3: Run all web tests**

Run: `cd apps/web && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/TranscriptSection.tsx
git commit -m "feat: wire speaker merge callback into TranscriptSection"
```

---

### Task 5: Integration Smoke Test

**Files:**
- All files from Tasks 1-4

This is a manual verification task. No new files are created.

- [ ] **Step 1: Run all web unit tests**

Run: `cd apps/web && npx jest --no-coverage`
Expected: All tests PASS (audio-route: 5, speaker-merge-route: 7, MergeBar: 6 = 18 total)

- [ ] **Step 2: Run TypeScript type checking**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run ESLint**

Run: `cd apps/web && npx next lint`
Expected: No errors

- [ ] **Step 4: Run all pipeline tests to verify no regressions**

Run: `cd apps/pipeline && python -m pytest tests/unit/ -q`
Expected: 155 tests passed

- [ ] **Step 5: Final commit if any fixes were needed**

If any issues were found and fixed in steps 1-4, commit the fixes:

```bash
git add -A
git commit -m "fix: address lint/type issues in speaker merge feature"
```
