# Worker Splitting: Separate Heavy and Light Task Queues

**Date:** 2026-03-18
**Status:** Approved

## Problem

All Celery tasks run on a single worker with concurrency=1 to prevent Whisper and pyannote from being in memory simultaneously (OOM risk on CPU-only machines). This means lightweight tasks like inference (~200 MB spaCy), downloads (I/O-bound), and archival (I/O-bound) must wait behind 30-60 minute transcription and diarization jobs.

The host machine has 16 cores and 42 GB RAM — plenty of headroom for lightweight tasks to run in parallel with heavy ones.

## Design

### Celery Task Routing

Add `task_routes` and `task_default_queue` to `apps/pipeline/app/tasks/celery_app.py`:

| Queue | Concurrency | Tasks | Resource Profile |
|---|---|---|---|
| `heavy` | 1 | `transcribe_episode`, `diarize_episode` | High CPU/RAM (6-8 GB each) |
| `light` (default) | 3 | `infer_speakers`, `download_episode`, `archive_episode`, `ingest_episode`, `ingest_feed`, `cleanup_zombie_jobs`, `poll_all_feeds` | Low CPU/RAM (<500 MB) |

Task names as registered in Celery (the `name=` argument on `@celery_app.task`):
- `transcribe_episode` -> `heavy`
- `diarize_episode` -> `heavy`
- `infer_speakers` -> `light`
- `download_episode` -> `light`
- `archive_episode` -> `light`
- `ingest_episode` -> `light`
- `ingest_feed` -> `light`
- `cleanup_zombie_jobs` -> `light`
- `poll_all_feeds` -> `light`

Set `task_default_queue = "light"` as a safety net so any unrouted tasks (including future ones) land on a consumed queue rather than Celery's built-in `celery` queue that no worker drains.

**Note:** `prewarm` is not a Celery task — it's a plain Python script run at container startup via `python -m app.tasks.prewarm`. It is not included in `task_routes`.

### Docker Compose Changes

**Modify existing `worker` service:**

Current command:
```
sh -c "python -m app.tasks.prewarm && celery -A app.tasks.celery_app worker --loglevel=info --concurrency=${CELERY_CONCURRENCY:-1}"
```

Updated command (add `-Q heavy`):
```
sh -c "python -m app.tasks.prewarm && celery -A app.tasks.celery_app worker -Q heavy --loglevel=info --concurrency=${CELERY_CONCURRENCY:-1}"
```

**Add `worker-light` service:**
- Same image as `worker` (same `build: ./apps/pipeline`)
- No prewarm step needed (no heavy models to load)
- Same env vars and dependencies as `worker`
- Depends on: db (healthy), redis (healthy), pipeline (healthy)

Command:
```
celery -A app.tasks.celery_app worker -Q light --loglevel=info --concurrency=${CELERY_LIGHT_CONCURRENCY:-3}
```

**Note on `worker_concurrency` in `celery_app.py`:** The app-level config sets `worker_concurrency` from `settings.celery_concurrency` (default 1). The CLI `--concurrency` flag overrides this at worker startup. The light worker's `--concurrency=3` (or `${CELERY_LIGHT_CONCURRENCY:-3}`) takes precedence over the app-level setting. No change to `celery_app.py`'s concurrency config is needed.

### Cross-Queue Handoffs

The pipeline chain crosses queues at two points:
- `diarize_episode` (heavy) dispatches `infer_speakers` (light) via `.delay()`
- `download_episode` (light) dispatches `transcribe_episode` (heavy) via `.delay()`

Both use `.delay()` which respects `task_routes` and dispatches to the correct queue. Retry re-enqueues (e.g., `download_episode.apply_async(...)`) also respect `task_routes` — no explicit `queue=` argument is needed.

**Failure mode:** If `worker-light` is down, tasks dispatched to the `light` queue will accumulate in Redis until it recovers. Episodes will appear stuck in their current stage. The `cleanup_zombie_jobs` task (which itself runs on `light`) cannot catch these since it's also on the down worker. This is acceptable — if a worker is down, manual intervention is expected. Both workers start independently and tasks are queue-buffered, so brief startup ordering differences are harmless.

### Celery Config Notes

**`worker_prefetch_multiplier`:** Currently set to 1 globally in `celery_app.py`. This remains appropriate for both workers. For the heavy worker (concurrency=1), it prevents a second long-running task from being prefetched and hitting visibility timeout. For the light worker (concurrency=3), each process prefetches 1 task, meaning up to 3 tasks buffered — adequate since light tasks complete quickly and the queue is always nearby in Redis.

**`visibility_timeout`:** Currently 7200s (2 hours) globally. This was sized for heavy transcription/diarization jobs. It's acceptable for both queues — light tasks complete well within this window, and per-queue visibility timeouts are not supported by Celery's Redis broker.

### What Doesn't Change

- Task code — no modifications to any task files. Routing is config-only.
- Beat scheduler — unchanged, tasks are routed at dispatch time.
- Flower — automatically monitors both workers.
- Retry logic — unchanged.

### Environment Variables

Add `CELERY_LIGHT_CONCURRENCY` to `.env.example` with default of 3. This var is consumed only in `docker-compose.yml` (as `${CELERY_LIGHT_CONCURRENCY:-3}` in the `worker-light` command), not via `config.py`. This differs from `CELERY_CONCURRENCY` which flows through `config.py` into the app-level Celery config — but since the CLI `--concurrency` flag overrides the app setting anyway, both approaches are equivalent. The existing `CELERY_CONCURRENCY` (default 1) continues to control the heavy worker.
