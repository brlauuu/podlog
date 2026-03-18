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

Each stage cell shows the count and stage name. Stages with zero episodes are still shown (dimmed) to preserve the pipeline shape.

### 2. Search Bar

Text input below the stage bar. Filters the episode table by title or podcast name (case-insensitive, client-side). Debounced at ~300ms.

### 3. Episode Table

Columns: Episode Title, Podcast, Stage (colored badge), Updated (relative time), Retries.

**Sort order:** Failed episodes first (highlighted with red background tint), then active episodes sorted by most recently updated, then pending episodes.

**Failed row expansion:** Clicking a failed row expands it to show error details: error class label, error message text, and a Retry button (disabled for DISK_FULL and OOM errors, per existing logic).

### 4. Done Section

Below the table: a collapsed section showing "Show N completed episodes" that expands to reveal done episodes in a table with the same columns. Collapsed by default to keep the view focused on in-progress and failed work.

### 5. Summary Counts

Inline with the search bar, show a text summary: "N active · N failed · N done" for quick orientation.

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

Add `done_jobs` to the queue response:
- Query episodes with `status = 'done'`, ordered by `updated_at` desc
- Include in `QueueStateResponse` alongside existing active/pending/failed arrays
- Add `done_count` to the response

### Web API proxy (`apps/web/src/app/api/queue/route.ts`)

No changes — already proxies the full response.

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
