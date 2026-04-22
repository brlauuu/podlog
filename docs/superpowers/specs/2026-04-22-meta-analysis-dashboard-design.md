# Meta-Analysis Dashboard — Design

**Status:** Draft
**Date:** 2026-04-22
**Issue:** [#521](https://github.com/brlauuu/podlog/issues/521)
**Owner:** @brlauuu

## Summary

Add a new top-level web section **Meta-analysis** (route `/meta-analysis`) that visualizes content-level metadata across the ingested podcast corpus. Content-first charts (episode length, word/token counts, speaker share, release cadence, speaker-pace, turn density, length trend) plus the two operational charts from the original ask (processing time, cumulative remote cost). Card-grid layout, colorful per-podcast color consistency, expandable per card. Data served from a single JSONB snapshot recomputed when the worker goes idle, plus a manual refresh button.

## Goals

1. Let the user explore podcast-level content metadata visually, with per-podcast comparison and over-time trends.
2. Keep the dashboard snappy (<200ms page paint) regardless of corpus size by precomputing the snapshot.
3. Recompute automatically after content changes (new episode, speaker rename, host re-inference) without wasting cycles during bulk ingest.
4. Surface when analysis is missing data (episodes with unassigned speakers) so the user knows where to go fix things.

## Non-goals

- Real-time live updates during ingest.
- Public-facing dashboard (Podlog is single-user self-hosted).
- Per-user preferences or saved views (single user).
- Cross-corpus benchmarks (external data sources).

## User stories

- "I want to compare the average episode length across my podcasts, with variance."
- "I want to see how frequently each podcast releases episodes over time."
- "I want to know how much I've spent on Fireworks inference per podcast."
- "I want to know how many tokens a full transcript is, so I can pick an LLM context size."
- "I want to see how much of each podcast the host speaks vs guests."
- "I want to see how fast each recurring speaker talks (words per minute)."
- "I want to know which episodes I haven't named speakers on yet, so I can fix them and re-run the analysis."

## Architecture

```
┌──────────────────────────┐        ┌────────────────────────────┐
│ Pipeline worker          │        │ PostgreSQL                 │
│                          │        │                            │
│ • On episode → done      │───────▶│  system_state              │
│   set flag=true          │        │   key=meta_analysis_stale  │
│ • On speaker rename      │───────▶│                            │
│   set flag=true          │        │  meta_analysis_snapshot    │
│ • Idle hook              │        │   (single row, JSONB)      │
│   if flag → recompute    │───────▶│                            │
│   UPSERT snapshot        │        │                            │
│   clear flag             │        │                            │
└──────────────────────────┘        └──────────┬─────────────────┘
                                               │
                                    ┌──────────▼─────────────────┐
                                    │ Pipeline FastAPI           │
                                    │  GET  /meta-analysis/...   │
                                    │  POST /meta-analysis/...   │
                                    └──────────┬─────────────────┘
                                               │
                                    ┌──────────▼─────────────────┐
                                    │ Next.js /api/meta-analysis │
                                    │  (proxy)                   │
                                    └──────────┬─────────────────┘
                                               │
                                    ┌──────────▼─────────────────┐
                                    │ /meta-analysis page        │
                                    │  React Query + Recharts    │
                                    └────────────────────────────┘
```

## Data model

### New migration — `015_add_meta_analysis_snapshot.py`

```sql
CREATE TABLE meta_analysis_snapshot (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  snapshot       jsonb       NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  episode_count  integer     NOT NULL DEFAULT 0,
  feed_count     integer     NOT NULL DEFAULT 0
);
```

Single-row table (check constraint enforces that). Writes use `INSERT ... ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, computed_at = EXCLUDED.computed_at, ...`.

### Stale flag

Reuses the existing `system_state` kv table:

- key: `meta_analysis_stale`
- value: `"true"` / `"false"` (text; no schema change)

### Snapshot JSONB shape

```json
{
  "per_feed": [
    {
      "feed_id": "uuid",
      "title": "string",
      "episode_count": 42,
      "avg_length_min": 54.2,
      "std_length_min": 8.1,
      "total_words": 1234567,
      "total_tokens_segments": 890123,
      "total_tokens_chunks": 885000,
      "total_cost_usd": 12.34,
      "total_audio_minutes": 2184.0,
      "inferred_host_name": "string|null"
    }
  ],

  "per_episode": [
    {
      "episode_id": "uuid",
      "feed_id": "uuid",
      "published_at": "ISO8601|null",
      "duration_secs": 3540,
      "word_count": 7812,
      "token_count_segments": 10230,
      "token_count_chunks": 10180,
      "speaker_count": 3,
      "turn_count": 142,
      "wpm": 132.5,
      "host_share": 0.68,
      "fireworks_cost_usd": 0.42,
      "transcribe_duration_secs": 180.4,
      "diarize_duration_secs": 95.2,
      "inference_provider_used": "fireworks|local|null"
    }
  ],

  "per_speaker": [
    {
      "speaker_display_name": "string",
      "feed_id": "uuid",
      "episode_ids": ["uuid", ...],
      "wpm": 128.0,
      "total_words": 58000,
      "total_seconds": 27200,
      "turn_count": 980
    }
  ],

  "timeline_monthly": [
    {
      "month": "2026-04",
      "feed_id": "uuid",
      "episode_count": 4,
      "total_words": 32000,
      "total_duration_min": 240
    }
  ],

  "coverage": {
    "host_share": {
      "included_count": 68,
      "excluded": [
        {"episode_id": "uuid", "feed_id": "uuid", "feed_title": "string",
         "title": "string", "reason": "no confirmed host"}
      ]
    },
    "wpm_speaker":   {"included_count": 140, "excluded": [...]},
    "tokens_chunks": {"included_count": 138, "excluded": [
      {"episode_id": "...", "reason": "no chunks yet"}
    ]}
  }
}
```

Inclusion rules:

- **All charts** require `episodes.status = 'done'`.
- **host_share / host-related charts**: (1) the feed must have an identifiable host — resolved via the existing PRD-04 chain (`feed_speaker_cache` top entry → `feed.podcast_persons` role=host → `feed.itunes_owner_name` / `itunes_author`), and (2) the episode must have a `speaker_names` row whose normalized `display_name` matches that host name with `confirmed_by_user = true OR confidence = 'HIGH'`. Episodes that fail either condition are surfaced in `coverage.host_share.excluded` with a specific reason string.
- **tokens_chunks**: episode must have chunks produced.
- **wpm_speaker**: speaker row requires `confirmed_by_user = true OR confidence = 'HIGH'`.

## Backend

### New module — `apps/pipeline/app/services/meta_analysis.py`

Exports:

- `compute_snapshot(db: Session) -> dict` — one read-only transaction; heavy lifting in SQL (GROUP BY feed, GROUP BY DATE_TRUNC('month', published_at), etc.); light Python for `tiktoken.get_encoding('cl100k_base').encode(text)` token counts.
- `upsert_snapshot(db: Session, snapshot: dict, episode_count: int, feed_count: int) -> None`.
- `is_stale(db: Session) -> bool` — reads `system_state['meta_analysis_stale']`.
- `set_stale(db: Session) -> None` — writes `"true"`.
- `clear_stale(db: Session) -> None` — writes `"false"`.

### Worker idle hook

In `apps/pipeline/app/worker.py`, inside the existing poll loop: after `claim_next_job()` returns `None` (no work), call a new helper `run_idle_hook(db)` that checks `is_stale()` and runs the compute + upsert + clear. At most once per idle period. Logged at INFO with compute duration.

### Stage hooks

Set the stale flag from:

**Pipeline side (Python):**

- `apps/pipeline/app/tasks/archive.py` — after episode transitions to `status=done`.
- `apps/pipeline/app/tasks/infer.py` — after any `SpeakerName` insert/update in the host-inference task.

**Web side (TypeScript — direct DB write):**

- `apps/web/src/app/api/episodes/[id]/speakers/route.ts` — after a user-driven rename/assign.
- `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts` — after a speaker merge.

The web app already holds a `pg` pool for direct DB reads (search); it reuses that pool to `INSERT INTO system_state (key, value) VALUES ('meta_analysis_stale','true') ON CONFLICT (key) DO UPDATE SET value='true'`. A tiny helper `apps/web/src/lib/metaAnalysisStale.ts` centralizes this write so both routes share one implementation.

Setting the flag is a single cheap UPSERT; safe to call redundantly.

### New API router — `apps/pipeline/app/api/meta_analysis.py`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/meta-analysis/snapshot` | — | `{snapshot, computed_at, episode_count, feed_count, is_stale, last_error}` |
| POST | `/meta-analysis/refresh` | — | same shape, synchronously recomputed |
| GET  | `/meta-analysis/coverage/missing-speakers` | — | `{podcasts: [{feed_id, title, episodes: [{id, title, reason}]}]}` |

The "missing-speakers" endpoint reads the same coverage block but returns it grouped-by-podcast for the modal. It's a convenience; the client could also derive it from the snapshot, but a dedicated endpoint allows lazy-loading if the excluded list grows very large.

### Tokenization

Dependency: `tiktoken` (add to `apps/pipeline/requirements.txt` if not already transitively present). Encoding: `cl100k_base`. Labeled "estimated tokens" in the UI. If import fails, log a warning and set `token_count_*` fields to `null`; the UI handles nulls gracefully.

### Force-refresh concurrency

`POST /meta-analysis/refresh` acquires `SELECT ... FOR UPDATE` on the snapshot row during compute. A concurrent request blocks until the first completes, then returns the fresh snapshot (no double-compute).

## Frontend

### Route & navigation

- **New route:** `apps/web/src/app/meta-analysis/page.tsx` — client component (`"use client"`).
- **Navbar entry:** `apps/web/src/components/Navbar.tsx` — add **Meta-analysis** between **Queue** and **Settings**.

### Component tree

```
apps/web/src/app/meta-analysis/
  page.tsx
  MetaAnalysisClient.tsx      # wraps React Query + filter state
  FiltersBar.tsx              # podcast multiselect, date range
  CoverageStrip.tsx           # "N podcasts · M processed · K queued/failed · X missing speakers"
  MissingSpeakersModal.tsx    # opaque backdrop, grouped by podcast, titles truncated (tooltip on hover)
  ChartCard.tsx               # shared card shell
  ExpandModal.tsx             # opaque backdrop, larger chart + sortable underlying-rows table
  InfoBlock.tsx               # segments-vs-chunks explainer
  charts/
    LengthPerFeed.tsx
    ReleaseTimeline.tsx
    EpisodeLengthTrend.tsx
    HostGuestShare.tsx
    TurnDensity.tsx
    WpmPerSpeaker.tsx
    TokensPerEpisode.tsx
    CostPerFeed.tsx
    ProcessingTimeDistribution.tsx

apps/web/src/lib/
  metaAnalysisColors.ts       # hash(feed_id) → color (stable across reloads)
  metaAnalysisTypes.ts        # TS types matching the snapshot JSONB

apps/web/src/app/api/meta-analysis/
  snapshot/route.ts           # proxy to pipeline GET /meta-analysis/snapshot
  refresh/route.ts            # proxy to pipeline POST /meta-analysis/refresh
  coverage/missing-speakers/route.ts
```

### Visual style

- **Layout:** card grid — 1 column mobile, 2 columns tablet, 3 columns desktop (responsive).
- **Aesthetic:** colorful / BI-punchy — each podcast has a consistent color across all charts.
- **Color palette:** 8–10 well-spaced hues in `metaAnalysisColors.ts`, hash-mapped from `feed_id` so a podcast keeps its color across refreshes. A hardcoded override map lets the user pin a specific color to a specific feed if hash collisions are unpleasant.
- **Dark-mode:** respects existing Podlog light/dark classes. Recharts is styled explicitly via props/className — grid/axis/tooltip colors read from Tailwind CSS tokens (the same ones the rest of the app uses) so the charts swap palettes with the rest of the UI.

### Data fetching

One query at the wrapper: `useQuery(['meta-analysis-snapshot'], fetchSnapshot)`. All chart components receive the relevant slice via props. Filter changes (podcast selection, date range) apply **client-side** against the in-memory arrays; no refetch.

Manual refresh: `useMutation(refreshSnapshot)` — shows spinner in header, invalidates `['meta-analysis-snapshot']` on success.

### Card interactions

Each `ChartCard` shows:

- Title + subtitle.
- The chart.
- A coverage footer (`"68 / 142 episodes · 74 excluded ▸"` — clickable, opens chart-local excluded-list modal).
- An expand icon — opens `ExpandModal` with the same chart at 2x size + a sortable table of underlying rows.

Modals use opaque backdrop, Esc / click-outside to close, scroll-lock on body.

### Refresh button & coverage strip

Sticky header contains: page title · filter bar · `↻ Refresh` button · "Updated N ago" timestamp · small warning icon if `last_error` is set.

Below header: coverage strip with three clickables:

1. `{K} queued/failed` → opens a modal listing non-done episodes with status & error_class.
2. `{X} missing speakers` → opens `MissingSpeakersModal`.
3. Each per-chart excluded count on the chart card.

Every excluded-episode row links to `/episodes/[id]` so the user can fix speakers, then return and hit ↻ Refresh.

### Charts — v1 content

| Card | Type | Source |
|---|---|---|
| Episode length per podcast | horizontal bars + σ error bars | `per_feed[].avg_length_min / std_length_min` |
| Release timeline | stacked area, monthly, per feed | `timeline_monthly` |
| Episode length trend per podcast | line per feed over time | `per_episode` grouped by `feed_id`, x=published_at, y=duration_secs |
| Host vs guest share | 100%-stacked bars per feed | `per_feed` + `per_episode[].host_share` |
| Turn density | scatter | x=`per_episode.duration_secs`, y=`turn_count/duration_min` |
| WPM per speaker | horizontal bars, grouped by feed | `per_speaker` |
| Tokens per episode | dual line (segments vs chunks) | `per_episode.token_count_*` |
| Cost per podcast | horizontal bars | `per_feed.total_cost_usd` |
| Processing time distribution | box-or-violin, local vs remote | `per_episode.transcribe_duration_secs + diarize_duration_secs` split by `inference_provider_used` |

Plus the `InfoBlock` segments-vs-chunks explainer rendered near the Tokens card.

### Dependencies to add

- `recharts` (web)
- `tiktoken` (pipeline, if not already transitively present)

## Refresh model

1. Stage hooks set `system_state['meta_analysis_stale'] = "true"` on relevant events. Pipeline writes on episode-done and inference updates; web app writes on user speaker rename/merge. Both sides UPSERT into the same `system_state` row.
2. Worker's poll loop, when it finds no job to claim, calls `run_idle_hook(db)` which: reads the stale flag, recomputes the snapshot if true, upserts the row, clears the flag.
3. Bulk ingest: many episodes finish → flag flips repeatedly → one recompute when queue drains.
4. Manual refresh: `POST /meta-analysis/refresh` runs `compute_snapshot()` inline and returns the fresh data. Ignores the idle-wait.

## Error handling

- **First run / empty snapshot.** API returns `{snapshot: null, is_stale: true}`. Page shows "No analysis yet — recompute runs when the queue is idle, or hit ↻ Refresh."
- **Chart-specific empty data.** Each chart handles its own empty state with a human message (e.g. host-share: "No confirmed hosts yet — rename speakers on episode pages").
- **tiktoken unavailable.** Pipeline logs warning, sets token fields to `null`; Tokens card shows "Token counts unavailable."
- **Stale flag missing.** Treated as `false` — defensive default.
- **Compute failure.** Exception logged, previous snapshot retained, API returns prior snapshot + `is_stale: true` + `last_error: "..."`. Coverage strip surfaces a warning icon.
- **Concurrent refreshes.** `SELECT ... FOR UPDATE` serializes them; no double-compute.
- **Worker interruptibility.** Idle-hook runs only when no claimable job exists. Compute is seconds; a new job waits those seconds before being picked up. No need to cancel the compute.

## Testing

### Pipeline (pytest)

- `tests/unit/services/test_meta_analysis.py` — `compute_snapshot()` with seeded test DB. Verifies per-feed aggregates, token counts, host-share excludes non-HIGH/unconfirmed, monthly bucketing, coverage counts sum correctly.
- `tests/unit/services/test_meta_analysis_coverage.py` — edge cases: feed with zero done, episode with zero chunks, all speakers unconfirmed, no inferred host.
- `tests/unit/test_worker_idle_hook.py` — idle hook calls compute once per stale→idle transition (mocks compute, asserts call count).
- `tests/integration/api/test_meta_analysis_api.py` — `GET /snapshot` empty state, populated state, `POST /refresh` synchronous.

### Web (jest + @testing-library/react)

- `MetaAnalysisClient.test.tsx` — loading / error / empty / populated.
- `CoverageStrip.test.tsx` — clicks open modals; titles truncated visually.
- `FiltersBar.test.tsx` — filter state changes propagate to chart props without refetch.
- Per-chart component tests (one per chart) — correct render from fixed dataset, stable `feed_id → color` mapping.

### Manual smoke (required before PR merge — CLAUDE.md Operational Gotcha #4)

1. `make build && make up`
2. Verify migration `015` runs cleanly (`docker compose logs pipeline`).
3. Open `/meta-analysis` — empty state renders.
4. Hit ↻ Refresh — snapshot populates.
5. Open missing-speakers modal, click through to `/episodes/[id]`.
6. Rename a speaker, return, refresh — chart updates.

### Operational constraints

- Per CLAUDE.md: rebuild the pipeline image after Python changes (`docker compose build pipeline`). Web-only changes rebuild web.
- `concurrency=1` worker is not interruptible; a new migration requires `docker compose stop -t 60 worker` before `up -d`, and confirm queue is drained via `SELECT status, COUNT(*) FROM job_queue WHERE status IN ('pending','running') GROUP BY status`.

## Out of scope / future work

- Saved views / bookmarkable filter URLs.
- Chart data export (CSV/JSON download).
- Cross-podcast ranking dashboards.
- Real-time streaming updates.
- Additional chart types beyond the v1 set listed above (user indicated chart content will evolve post-v1).
