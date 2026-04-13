# Episode Detail Page — Metadata Tags Design

## Problem

The individual episode page (`/episodes/[id]`) displays metadata (published date, duration, transcription time, diarization time, Fireworks STT cost) as plain muted text spans. Issue #355 asked for these to become tags/badges; PR #363 implemented that for episode list cards (`EpisodesList.tsx`) but never touched the detail page. Issue #376 surfaces this gap.

## Goal

Replace the plain-text metadata rows on the episode detail page with a tag strip matching the visual style already used in `EpisodesList.tsx`, and move the Reprocess button to its own action row below the tags.

## Design

### Component

A single new client component `apps/web/src/components/EpisodeMetaTags.tsx` encapsulates all metadata display and interaction for the episode detail page. `page.tsx` remains a Server Component and passes metadata as props.

### Layout

**Row 1 — informational tags (`flex-wrap gap-1.5`):**

| Tag | Condition | Style |
|-----|-----------|-------|
| Status (e.g. "Transcribing", "Failed") | `status !== "done"` | Blue/red outline badge (existing `StatusBadge` logic) |
| Published date | `published_at != null` | `bg-muted text-muted-foreground` |
| Duration | `duration_secs != null` | `bg-muted text-muted-foreground` |
| Transcribed: Xs | `transcribe_duration_secs != null` | `bg-muted text-muted-foreground` |
| Diarized: Xs ▾ | `diarize_duration_secs != null` | `bg-muted text-muted-foreground` + clickable toggle |
| Fireworks STT: $x.xx | `inference_provider_used === "fireworks" && fireworks_stt_cost_usd != null` | `bg-muted text-muted-foreground` + hover tooltip |

**Row 2 — collapsible diarization steps (conditional, below row 1):**

Shown when user clicks the "Diarized" tag. Renders each key in `diarize_step_durations` as a tag using the existing `formatDiarizeStepLabel` helper. Hidden by default.

**Row 3 — actions:**

`ReprocessButton` on its own row, below the tags.

### Tag Style

Matches `EpisodesList.tsx` exactly:

```tsx
<span className="text-xs px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">
  {children}
</span>
```

`Tag` is defined locally in `EpisodeMetaTags.tsx` — no extraction from `EpisodesList.tsx` needed.

### FireworksCostTag Tooltip

On hover, shows a popover with:
- Audio duration in minutes
- Exact cost to 4 decimal places
- Rate per minute (cost / minutes)

Same implementation as `EpisodesList.tsx`.

### Diarization Step Labels

Reuse the `formatDiarizeStepLabel` logic (from `page.tsx`) inside `EpisodeMetaTags.tsx`. The function and `STEP_ABBREVIATIONS` map move into the new component and are removed from `page.tsx`.

### Duration Formatting

Use the existing `formatTimestamp` utility from `@/lib/timestamp` for all durations.

## Props Interface

```tsx
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
```

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/components/EpisodeMetaTags.tsx` | Create — new client component |
| `apps/web/src/app/episodes/[id]/page.tsx` | Modify — replace metadata divs with `<EpisodeMetaTags />` |
| `apps/web/tests/unit/EpisodeMetaTags.test.tsx` | Create — unit tests |

## Out of Scope

- Changes to `EpisodesList.tsx`
- Extracting shared `Tag` component
- Any other episode page UI changes
