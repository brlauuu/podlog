# Queue Page Redesign

**Date:** 2026-03-18
**Status:** Approved

## Problem

The current queue page (`QueueStatus.tsx`, 648 lines) has three grouping modes (by status, by podcast, by stage), two view styles (list, kanban), and localStorage-persisted preferences. This complexity doesn't serve the actual need: seeing which stage each episode is in and spotting failures quickly.

## Design

Replace with a **Summary + Table Hybrid** layout:

### 1. Stage Progress Bar

A compact horizontal bar across the top showing episode counts per pipeline stage, color-coded:

| Stage | Color |
|---|---|
| Pending | Yellow (#eab308) |
| Downloading | Cyan (#06b6d4) |
| Transcribing | Blue (#2563eb) |
| Diarizing | Purple (#7c3aed) |
| Inferring | Orange (#f97316) |
| Archiving | Teal (#14b8a6) |
| Done | Green (#16a34a) |
| Failed | Red (#dc2626) |

Each stage cell shows the count and stage name. Stages with zero episodes are still shown (dimmed) to preserve the pipeline shape. The stage bar is display-only (no click interaction).

### 2. Search Bar

Text input below the stage bar, with summary counts ("N active · N failed · N done") on the right. Filters the episode table and done section by title or podcast name (case-insensitive, client-side). Debounced at ~300ms. When no episodes match the search, show "No episodes match your search" in place of the table.

### 3. Episode Table

Columns: Episode Title, Podcast, Stage (colored badge), Updated (relative time), Retries.

**Sort order:**
- **Failed** episodes first, sorted by `updated_at` desc (most recent failure on top)
- **Active** episodes second (status in: downloading, transcribing, diarizing, inferring, archiving), sorted by `updated_at` desc
- **Pending** episodes last, sorted by `updated_at` desc

**Retries column:** Displays as "N/M" (e.g., "1/3") when `retry_count > 0`, otherwise "—".

**Test badge:** Episodes from test-mode feeds (`feed_mode = 'test'`) show a "Test" badge next to the podcast name, preserving the existing behavior.

**Failed row expansion:** Clicking a failed row expands it to show error details: error class label (human-readable, e.g., "Network error", "Out of memory"), error message text, and a Retry button (disabled for DISK_FULL and OOM errors, per existing logic).

**Empty state:** When there are no episodes at all (no active, pending, failed, or done), show "No episodes in the queue. Add a feed to get started." with a link to the feeds page.

### 4. Done Section

Below the table: a collapsed section showing "Show N completed episodes" that expands to reveal done episodes in a table with the same columns. Collapsed by default to keep the view focused on in-progress and failed work. Done episodes sorted by `updated_at` desc.

### 5. Responsiveness

On narrow screens (<640px), hide the Podcast and Retries columns. The table scrolls horizontally only as a last resort.

## Components

| Component | Purpose |
|---|---|
| `QueuePage` (page.tsx) | Page container, unchanged |
| `QueueStatus` | Main component — data fetching (5s polling via React Query), state, layout |
| `StageBar` | Horizontal stage progress bar with counts |
| `EpisodeTable` | Table with search, sort, and expandable failed rows |
| `StatusBadge` | Colored badge per stage (extracted from existing code) |

All components live in `QueueStatus.tsx` as a single file (not split into separate files) since they're tightly coupled and only used here.

## Data Changes

### Pipeline API (`apps/pipeline/app/api/queue.py`)

1. **Add `inferring` to the active jobs query.** The current query filters on `["downloading", "transcribing", "diarizing", "archiving"]` but misses `"inferring"`. Add it.

2. **Add `updated_at` to `_job_dict` serialization.** The table's "Updated" column and sort order depend on this field. Serialize as ISO 8601 string (or null).

3. **Add `done_jobs` to the response.** Query episodes with `status = 'done'`, ordered by `updated_at` desc, **limited to 50 rows** to avoid returning the entire history on every 5-second poll. Add `done_count: int` (total count) and `done_jobs: list[dict]` (limited set) to `QueueStateResponse`.

### Web API proxy (`apps/web/src/app/api/queue/route.ts`)

No changes — already proxies the full response.

## PRD-02 Deviations

The following PRD-02 §5.6 features are intentionally dropped in this redesign:

- **Worker warm-up banner:** Removed. The warm-up phase is brief and the banner adds complexity for minimal value. PRD-02 should be updated to note this.
- **Retry countdown timer ("Next attempt in 2m"):** Dropped. The retry count (N/M) is shown but not the countdown to next attempt, since this would require tracking backoff timers client-side. The retries column provides sufficient information.

PRD-02 will be updated as part of implementation to reflect these changes.

## What Gets Removed

- Kanban board (KanbanColumn, KanbanBoard, BoardCard components)
- Three grouping modes and toggle UI (groupByStatus, groupByPodcast, groupByStage)
- CollapsibleGroup component
- localStorage preferences (`podlog-queue-grouping`, `podlog-queue-view-style`)
- Health endpoint polling (worker warm-up state display)

## What Stays

- 5-second polling via React Query
- Retry functionality for failed jobs (POST to pipeline API)
- Error class handling (DISK_FULL and OOM non-retryable)
- Relative time display ("5m ago", "2h ago")
- Dark mode support via Tailwind `class` strategy
- Pulse animation on active stage badges
- Test badge for test-mode feeds
