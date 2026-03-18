# Worker Splitting: Separate Heavy and Light Task Queues

**Date:** 2026-03-18
**Status:** Approved

## Problem

All Celery tasks run on a single worker with concurrency=1 to prevent Whisper and pyannote from being in memory simultaneously (OOM risk on CPU-only machines). This means lightweight tasks like inference (~200 MB spaCy), downloads (I/O-bound), and archival (I/O-bound) must wait behind 30-60 minute transcription and diarization jobs.

The host machine has 16 cores and 42 GB RAM — plenty of headroom for lightweight tasks to run in parallel with heavy ones.

## Design

### Celery Task Routing

Add `task_routes` to `apps/pipeline/app/tasks/celery_app.py`:

| Queue | Concurrency | Tasks | Resource Profile |
|---|---|---|---|
| `heavy` | 1 | `transcribe_episode`, `diarize_episode`, `prewarm` | High CPU/RAM (6-8 GB each) |
| `light` | 3 | `infer_speakers`, `download_episode`, `archive_episode`, `ingest_episode`, `cleanup_stalled_jobs`, `poll_feeds` | Low CPU/RAM (<500 MB) |

Task names as registered in Celery (the `name=` argument on `@celery_app.task`):
- `transcribe_episode` -> `heavy`
- `diarize_episode` -> `heavy`
- `prewarm` -> `heavy`
- `infer_speakers` -> `light`
- `download_episode` -> `light`
- `archive_episode` -> `light`
- `ingest_episode` -> `light`
- `cleanup_stalled_jobs` -> `light`
- `poll_feeds` -> `light`

### Docker Compose Changes

**Modify existing `worker` service:**
- Add `-Q heavy` to the Celery command so it only consumes the `heavy` queue
- Keep prewarm step (loads Whisper/pyannote models)
- Keep `concurrency=1`

**Add `worker-light` service:**
- Same image as `worker` (same `build: ./apps/pipeline`)
- Command: `celery -A app.tasks.celery_app worker -Q light --loglevel=info --concurrency=3`
- No prewarm step needed (no heavy models to load)
- Same env vars and dependencies as `worker`
- Depends on: db (healthy), redis (healthy), pipeline (healthy)

### What Doesn't Change

- Task code — no modifications to any task files. Routing is config-only.
- Beat scheduler — unchanged, tasks are routed at dispatch time.
- Flower — automatically monitors both workers.
- Pipeline chain — `download -> transcribe -> diarize -> infer -> archive` still works because `.delay()` dispatches to whichever queue the task is routed to via `task_routes`.
- Retry logic — unchanged.

### Environment Variables

Add `CELERY_LIGHT_CONCURRENCY` to `.env.example` with default of 3. The existing `CELERY_CONCURRENCY` (default 1) continues to control the heavy worker.
