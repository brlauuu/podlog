# Episode Detail Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text metadata rows on the episode detail page with a tag strip matching `EpisodesList.tsx`, and move the Reprocess button to its own action row.

**Architecture:** New `EpisodeMetaTags.tsx` client component receives all metadata as props from the Server Component `page.tsx`. All interactive state (tooltip hover, diarization steps expand/collapse) lives inside the client component. `page.tsx` is simplified by replacing 4 metadata divs with one component call.

**Tech Stack:** Next.js 15 App Router, React, Tailwind CSS, shadcn/ui Badge, `@/lib/timestamp` formatTimestamp, existing `ReprocessButton`

---

### Task 1: Create `EpisodeMetaTags.tsx` with static tags and tests

**Files:**
- Create: `apps/web/src/components/EpisodeMetaTags.tsx`
- Create: `apps/web/tests/unit/EpisodeMetaTags.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/tests/unit/EpisodeMetaTags.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import EpisodeMetaTags from "@/components/EpisodeMetaTags";

const baseProps = {
  status: "done",
  publishedAt: "2024-03-15T10:00:00Z",
  durationSecs: 3723,
  transcribeDurationSecs: 142,
  diarizeDurationSecs: 88,
  diarizeStepDurations: null,
  inferenceProviderUsed: null,
  fireworksSttCostUsd: null,
  fireworksAudioMinutes: null,
  episodeId: "ep-123",
};

describe("EpisodeMetaTags", () => {
  it("renders published date tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    // Date is locale-dependent; check partial content
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it("renders duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
  });

  it("renders transcription duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText(/Transcribed:/)).toBeInTheDocument();
    expect(screen.getByText(/2:22/)).toBeInTheDocument();
  });

  it("renders diarization duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText(/Diarized:/)).toBeInTheDocument();
    expect(screen.getByText(/1:28/)).toBeInTheDocument();
  });

  it("does not render status tag when status is done", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.queryByText(/Transcribing|Downloading|Diarizing|Failed/)).not.toBeInTheDocument();
  });

  it("renders status tag for in-progress status", () => {
    render(<EpisodeMetaTags {...baseProps} status="transcribing" />);
    expect(screen.getByText("Transcribing")).toBeInTheDocument();
  });

  it("renders status tag for failed status", () => {
    render(<EpisodeMetaTags {...baseProps} status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("omits date tag when publishedAt is null", () => {
    const { container } = render(<EpisodeMetaTags {...baseProps} publishedAt={null} />);
    // Just check no crash and duration still renders
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
  });

  it("omits transcription tag when transcribeDurationSecs is null", () => {
    render(<EpisodeMetaTags {...baseProps} transcribeDurationSecs={null} />);
    expect(screen.queryByText(/Transcribed:/)).not.toBeInTheDocument();
  });

  it("omits diarization tag when diarizeDurationSecs is null", () => {
    render(<EpisodeMetaTags {...baseProps} diarizeDurationSecs={null} />);
    expect(screen.queryByText(/Diarized:/)).not.toBeInTheDocument();
  });

  it("does not render Fireworks tag when inferenceProviderUsed is not fireworks", () => {
    render(<EpisodeMetaTags {...baseProps} inferenceProviderUsed="local" />);
    expect(screen.queryByText(/Fireworks STT/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx jest tests/unit/EpisodeMetaTags.test.tsx --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '@/components/EpisodeMetaTags'`

- [ ] **Step 3: Create `EpisodeMetaTags.tsx` with static tags**

Create `apps/web/src/components/EpisodeMetaTags.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";
import { formatTimestamp } from "@/lib/timestamp";
import ReprocessButton from "@/components/ReprocessButton";

interface EpisodeMetaTagsProps {
  status: string;
  publishedAt: string | null;
  durationSecs: number | null;
  transcribeDurationSecs: number | null;
  diarizeDurationSecs: number | null;
  diarizeStepDurations: Record<string, number> | null;
  inferenceProviderUsed: string | null;
  fireworksSttCostUsd: number | null;
  fireworksAudioMinutes: number | null;
  episodeId: string;
}

const STEP_ABBREVIATIONS: Record<string, string> = {
  io: "I/O", api: "API", stt: "STT", url: "URL",
};

function formatDiarizeStepLabel(key: string): string {
  const words = key.replace(/_secs$/, "").split("_").filter(Boolean);
  if (!words.length) return key;
  const formatted = words.map(w => STEP_ABBREVIATIONS[w.toLowerCase()] ?? w.toLowerCase());
  const label = formatted.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${className ?? "bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  const isFailed = status === "failed";
  const label = isFailed ? "Failed" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium border ${
        isFailed
          ? "text-red-700 border-red-300 dark:text-red-300 dark:border-red-700"
          : "text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-700"
      }`}
    >
      {isFailed ? <XCircle size={10} /> : <Loader2 size={10} className="animate-spin" />}
      {label}
    </span>
  );
}

function FireworksCostTag({
  costUsd,
  audioMinutes,
}: {
  costUsd: number;
  audioMinutes: number | null;
}) {
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

export default function EpisodeMetaTags({
  status,
  publishedAt,
  durationSecs,
  transcribeDurationSecs,
  diarizeDurationSecs,
  diarizeStepDurations,
  inferenceProviderUsed,
  fireworksSttCostUsd,
  fireworksAudioMinutes,
  episodeId,
}: EpisodeMetaTagsProps) {
  const [stepsExpanded, setStepsExpanded] = useState(false);

  const hasSteps =
    diarizeStepDurations != null && Object.keys(diarizeStepDurations).length > 0;

  return (
    <div className="space-y-2">
      {/* Row 1: informational tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {status !== "done" && <StatusTag status={status} />}

        {publishedAt && (
          <Tag>{new Date(publishedAt).toLocaleDateString()}</Tag>
        )}

        {durationSecs != null && (
          <Tag>{formatTimestamp(durationSecs)}</Tag>
        )}

        {transcribeDurationSecs != null && (
          <Tag>Transcribed: {formatTimestamp(transcribeDurationSecs)}</Tag>
        )}

        {diarizeDurationSecs != null && (
          <button
            onClick={() => setStepsExpanded(v => !v)}
            className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            aria-expanded={stepsExpanded}
          >
            Diarized: {formatTimestamp(diarizeDurationSecs)}
            {hasSteps && (
              stepsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />
            )}
          </button>
        )}

        {inferenceProviderUsed === "fireworks" && fireworksSttCostUsd != null && (
          <FireworksCostTag
            costUsd={fireworksSttCostUsd}
            audioMinutes={fireworksAudioMinutes}
          />
        )}
      </div>

      {/* Row 2: collapsible diarization step breakdown */}
      {stepsExpanded && hasSteps && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(diarizeStepDurations!).map(([step, secs]) => (
            <Tag key={step}>
              {formatDiarizeStepLabel(step)}: {formatTimestamp(secs)}
            </Tag>
          ))}
        </div>
      )}

      {/* Row 3: actions */}
      <div>
        <ReprocessButton episodeId={episodeId} status={status} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx jest tests/unit/EpisodeMetaTags.test.tsx --no-coverage 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/src/components/EpisodeMetaTags.tsx apps/web/tests/unit/EpisodeMetaTags.test.tsx
git commit -m "feat(episode-page): add EpisodeMetaTags client component with tag strip"
```

---

### Task 2: Add tests for Fireworks tag and diarization step expansion

**Files:**
- Modify: `apps/web/tests/unit/EpisodeMetaTags.test.tsx`

- [ ] **Step 1: Add tests for Fireworks and collapsible steps**

Append to the `describe` block in `apps/web/tests/unit/EpisodeMetaTags.test.tsx`:

```tsx
import userEvent from "@testing-library/user-event";

// Add these inside the describe("EpisodeMetaTags") block:

  it("renders Fireworks STT cost tag when provider is fireworks", () => {
    render(
      <EpisodeMetaTags
        {...baseProps}
        inferenceProviderUsed="fireworks"
        fireworksSttCostUsd={0.0312}
        fireworksAudioMinutes={6.2}
      />
    );
    expect(screen.getByText(/Fireworks STT: \$0\.03/)).toBeInTheDocument();
  });

  it("shows diarization step tags when Diarized tag is clicked", async () => {
    const user = userEvent.setup();
    render(
      <EpisodeMetaTags
        {...baseProps}
        diarizeStepDurations={{ load_model_secs: 5, run_pipeline_secs: 83 }}
      />
    );
    expect(screen.queryByText(/Load model:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Diarized:/ }));
    expect(screen.getByText(/Load model:/)).toBeInTheDocument();
    expect(screen.getByText(/Run pipeline:/)).toBeInTheDocument();
  });

  it("hides diarization step tags when Diarized tag is clicked again", async () => {
    const user = userEvent.setup();
    render(
      <EpisodeMetaTags
        {...baseProps}
        diarizeStepDurations={{ load_model_secs: 5, run_pipeline_secs: 83 }}
      />
    );
    const btn = screen.getByRole("button", { name: /Diarized:/ });
    await user.click(btn);
    await user.click(btn);
    expect(screen.queryByText(/Load model:/)).not.toBeInTheDocument();
  });

  it("does not show chevron on Diarized tag when no step breakdown is available", () => {
    render(<EpisodeMetaTags {...baseProps} diarizeStepDurations={null} />);
    // Diarized tag should still render but without expand chevron
    expect(screen.getByRole("button", { name: /Diarized:/ })).toBeInTheDocument();
    expect(screen.queryByTestId("chevron-down")).not.toBeInTheDocument();
  });

  it("renders ReprocessButton", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    // ReprocessButton renders a button; check it's present
    expect(screen.getByRole("button", { name: /Reprocess/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd apps/web && npx jest tests/unit/EpisodeMetaTags.test.tsx --no-coverage 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/tests/unit/EpisodeMetaTags.test.tsx
git commit -m "test(episode-page): add Fireworks and diarization step expansion tests"
```

---

### Task 3: Wire `EpisodeMetaTags` into `page.tsx`

**Files:**
- Modify: `apps/web/src/app/episodes/[id]/page.tsx`

- [ ] **Step 1: Replace metadata divs with `EpisodeMetaTags`**

In `apps/web/src/app/episodes/[id]/page.tsx`:

Remove these imports (no longer used directly in page.tsx):
```tsx
import { Loader2, XCircle } from "lucide-react";  // keep AlertTriangle, Info, CheckCircle2 if used elsewhere
```

Remove the `StatusBadge` function (lines 19–42) and the `STEP_ABBREVIATIONS`, `formatDiarizeStepLabel` definitions (lines 76–86) — they move into `EpisodeMetaTags.tsx`.

Add import:
```tsx
import EpisodeMetaTags from "@/components/EpisodeMetaTags";
```

Replace the header metadata block. The current block (from `<div className="mt-2 space-y-2">` through the closing `</div>` of the Fireworks section, around lines 188–235) becomes:

```tsx
<div className="mt-2 space-y-2">
  <h1 className="text-xl font-semibold">{episode.title ?? "Untitled Episode"}</h1>
  <EpisodeMetaTags
    status={episode.status}
    publishedAt={episode.published_at}
    durationSecs={episode.duration_secs}
    transcribeDurationSecs={episode.transcribe_duration_secs}
    diarizeDurationSecs={episode.diarize_duration_secs}
    diarizeStepDurations={episode.diarize_step_durations}
    inferenceProviderUsed={episode.inference_provider_used}
    fireworksSttCostUsd={episode.fireworks_stt_cost_usd}
    fireworksAudioMinutes={episode.fireworks_audio_minutes}
    episodeId={episode.id}
  />
</div>
```

Also remove the standalone `<ReprocessButton>` import from the top — it's now used inside `EpisodeMetaTags` only.

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Run full web test suite**

```bash
cd apps/web && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/src/app/episodes/[id]/page.tsx
git commit -m "feat(episode-page): replace plain-text metadata with EpisodeMetaTags tag strip (fixes #376)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite and typecheck**

```bash
cd apps/web && npx tsc --noEmit && npx jest --no-coverage 2>&1 | tail -10
```

Expected: typecheck clean, all tests pass

- [ ] **Step 2: Verify no unused imports remain in page.tsx**

```bash
cd apps/web && npx eslint src/app/episodes/\\[id\\]/page.tsx --no-eslintrc -c '{"extends":"next/core-web-vitals"}' 2>&1 | grep -i "no-unused"
```

Fix any flagged unused imports.

- [ ] **Step 3: Commit cleanup if needed**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/src/app/episodes/[id]/page.tsx
git commit -m "chore(episode-page): remove unused imports after EpisodeMetaTags refactor"
```
