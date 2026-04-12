# Episode Page UI Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize episode list metadata tags and make reprocess button always visible

**Architecture:** Modify EpisodesList.tsx to reorder tags, split processing times, update fireworks cost display with tooltip, and always show reprocess button

**Tech Stack:** Next.js, React, Tailwind CSS, Radix UI Popover

---

### Task 1: Update ReprocessButton to always render

**Files:**
- Modify: `apps/web/src/components/ReprocessButton.tsx:16`

- [ ] **Step 1: Remove status check**

Change line 16 from:
```tsx
if (status !== "done" && status !== "failed") return null;
```
to:
```tsx
// Always render - let parent control visibility if needed
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ReprocessButton.tsx
git commit -m "feat: reprocess button always renders"
```

---

### Task 2: Reorganize tag row in EpisodesList

**Files:**
- Modify: `apps/web/src/components/EpisodesList.tsx:355-403`

- [ ] **Step 1: Add FireworksTooltipTag component**

Add after existing Tag components (around line 130):

```tsx
function FireworksCostTag({ costUsd, audioMinutes }: { costUsd: number; audioMinutes: number | null }) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Tag className="bg-muted text-muted-foreground cursor-default">
        Fireworks STT: ${costUsd.toFixed(2)}
      </Tag>
      {showTooltip && (
        <div className="absolute z-50 bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 p-2 rounded-md bg-popover text-popover-foreground text-xs shadow-md border">
          <div className="font-medium mb-1">Fireworks STT Details</div>
          {audioMinutes != null && <div>Audio: {audioMinutes.toFixed(1)} min</div>}
          <div>Cost: ${costUsd.toFixed(4)}</div>
          {audioMinutes != null && audioMinutes > 0 && (
            <div>Rate: ${(costUsd / audioMinutes).toFixed(4)}/min</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update imports**

Add `useState` to existing import on line 3 if not present.

- [ ] **Step 3: Refactor tag row (lines 355-403)**

Replace the tag row with:

```tsx
{/* Tag strip — metadata row */}
<div className="flex flex-wrap items-center gap-1.5 mt-2 relative z-10 pointer-events-none">
  <StatusTag status={ep.status} />

  {!ep.has_diarization && ep.status === "done" && (
    <Tag className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      <AlertTriangle size={10} />
      No labels
    </Tag>
  )}

  {ep.published_at && (
    <Tag className="bg-muted text-muted-foreground">
      {new Date(ep.published_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
    </Tag>
  )}

  {ep.duration_secs != null && (
    <Tag className="bg-muted text-muted-foreground">
      {formatDuration(ep.duration_secs)}
    </Tag>
  )}

  {ep.language && (
    <Tag className="bg-muted text-muted-foreground">
      {flag ? `${flag} ` : ""}{ep.language.toUpperCase()}
    </Tag>
  )}

  {ep.inference_provider_used && (
    <ProviderTag provider={ep.inference_provider_used} />
  )}

  {ep.status === "done" && ep.transcribe_duration_secs != null && ep.transcribe_duration_secs > 0 && (
    <Tag className="bg-muted text-muted-foreground">
      Transcribed: {formatDuration(ep.transcribe_duration_secs)}
    </Tag>
  )}

  {ep.status === "done" && ep.diarize_duration_secs != null && ep.diarize_duration_secs > 0 && (
    <Tag className="bg-muted text-muted-foreground">
      Diarized: {formatDuration(ep.diarize_duration_secs)}
    </Tag>
  )}

  {ep.inference_provider_used === "fireworks" && ep.fireworks_stt_cost_usd != null && (
    <FireworksCostTag 
      costUsd={ep.fireworks_stt_cost_usd} 
      audioMinutes={ep.fireworks_audio_minutes} 
    />
  )}
</div>
```

- [ ] **Step 4: Add ReprocessButton to tag row**

After the tag strip closing div (around line 403), add the ReprocessButton:

```tsx
{/* Reprocess button - always visible, right-aligned */}
<div className="absolute right-2 top-2 z-20">
  <ReprocessButton episodeId={ep.id} status={ep.status} />
</div>
```

Note: The parent div needs `relative` class - verify line 337 has it.

- [ ] **Step 5: Remove duplicate reprocess button code**

Remove the reprocess button from the failed episode details section (lines 449-458) since it's now always visible.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/EpisodesList.tsx
git commit -m "feat: reorganize episode tags, add fireworks tooltip, always show reprocess"
```

---

### Task 3: Add import for ReprocessButton

**Files:**
- Modify: `apps/web/src/components/EpisodesList.tsx:1-11`

- [ ] **Step 1: Add ReprocessButton import**

Add to imports:
```tsx
import ReprocessButton from "./ReprocessButton";
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/EpisodesList.tsx
git commit -m "chore: add ReprocessButton import"
```

---

### Task 4: Verify implementation

- [ ] **Step 1: Run type check**

```bash
cd apps/web && npm run typecheck
```

- [ ] **Step 2: Run linter**

```bash
cd apps/web && npm run lint
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: typecheck/lint issues"
```