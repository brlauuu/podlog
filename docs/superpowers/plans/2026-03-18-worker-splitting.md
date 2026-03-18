# Worker Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single Celery worker into a heavy worker (transcription/diarization, concurrency=1) and a light worker (downloads, inference, archival, concurrency=3) so lightweight tasks don't queue behind 30-60 minute jobs.

**Architecture:** Add `task_routes` and `task_default_queue` to `celery_app.py` so Celery routes tasks to `heavy` or `light` queues. Modify the existing `worker` service in `docker-compose.yml` to consume only `heavy`, and add a `worker-light` service that consumes only `light`. No task code changes — routing is config-only.

**Tech Stack:** Celery 5, Redis 7, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-18-worker-splitting-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/pipeline/app/tasks/celery_app.py` | Modify | Add `task_routes` dict and `task_default_queue` |
| `apps/pipeline/tests/unit/test_celery_config.py` | Create | Tests for task routing config |
| `docker-compose.yml` | Modify | Add `-Q heavy` to worker, add `worker-light` service |
| `.env.example` | Modify | Add `CELERY_LIGHT_CONCURRENCY` |

---

### Task 1: Add Celery task routing config

**Files:**
- Modify: `apps/pipeline/app/tasks/celery_app.py:21-38`
- Create: `apps/pipeline/tests/unit/test_celery_config.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/pipeline/tests/unit/test_celery_config.py`:

```python
"""Tests for Celery task routing configuration."""

from app.tasks.celery_app import celery_app


HEAVY_TASKS = ["transcribe_episode", "diarize_episode"]
LIGHT_TASKS = [
    "infer_speakers",
    "download_episode",
    "archive_episode",
    "ingest_episode",
    "ingest_feed",
    "cleanup_zombie_jobs",
    "poll_all_feeds",
]


def test_heavy_tasks_route_to_heavy_queue():
    routes = celery_app.conf.task_routes
    for task_name in HEAVY_TASKS:
        assert routes[task_name]["queue"] == "heavy", f"{task_name} should route to heavy"


def test_light_tasks_route_to_light_queue():
    routes = celery_app.conf.task_routes
    for task_name in LIGHT_TASKS:
        assert routes[task_name]["queue"] == "light", f"{task_name} should route to light"


def test_default_queue_is_light():
    assert celery_app.conf.task_default_queue == "light"


def test_all_registered_tasks_have_routes():
    """Every task in the 'include' modules should have an explicit route."""
    routes = celery_app.conf.task_routes
    routed_tasks = set(routes.keys())
    expected = set(HEAVY_TASKS + LIGHT_TASKS)
    assert routed_tasks == expected


def test_no_tasks_route_to_default_celery_queue():
    """No task should route to the built-in 'celery' queue."""
    routes = celery_app.conf.task_routes
    for task_name, route in routes.items():
        assert route["queue"] != "celery", f"{task_name} routes to default 'celery' queue"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_celery_config.py -v`
Expected: FAIL — `task_routes` is not set yet, so `celery_app.conf.task_routes` is `None` or empty.

- [ ] **Step 3: Add task_routes and task_default_queue to celery_app.py**

In `apps/pipeline/app/tasks/celery_app.py`, add the following two keys to the `celery_app.conf.update(...)` call (after the existing `worker_prefetch_multiplier` line):

```python
    # --- Task routing: heavy vs light worker queues ---
    task_default_queue="light",
    task_routes={
        "transcribe_episode": {"queue": "heavy"},
        "diarize_episode": {"queue": "heavy"},
        "infer_speakers": {"queue": "light"},
        "download_episode": {"queue": "light"},
        "archive_episode": {"queue": "light"},
        "ingest_episode": {"queue": "light"},
        "ingest_feed": {"queue": "light"},
        "cleanup_zombie_jobs": {"queue": "light"},
        "poll_all_feeds": {"queue": "light"},
    },
```

The full `celery_app.conf.update(...)` block should now end with:

```python
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    worker_concurrency=settings.celery_concurrency,
    result_expires=604800,
    task_track_started=True,
    broker_transport_options={"visibility_timeout": 7200},
    worker_prefetch_multiplier=1,
    # --- Task routing: heavy vs light worker queues ---
    task_default_queue="light",
    task_routes={
        "transcribe_episode": {"queue": "heavy"},
        "diarize_episode": {"queue": "heavy"},
        "infer_speakers": {"queue": "light"},
        "download_episode": {"queue": "light"},
        "archive_episode": {"queue": "light"},
        "ingest_episode": {"queue": "light"},
        "ingest_feed": {"queue": "light"},
        "cleanup_zombie_jobs": {"queue": "light"},
        "poll_all_feeds": {"queue": "light"},
    },
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_celery_config.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/tasks/celery_app.py apps/pipeline/tests/unit/test_celery_config.py
git commit -m "feat: add Celery task routing for heavy/light worker queues"
```

---

### Task 2: Update Docker Compose for dual workers

**Files:**
- Modify: `docker-compose.yml:56-76` (worker service) and add new service after it

- [ ] **Step 1: Add `-Q heavy` to the existing worker command**

In `docker-compose.yml`, modify the `worker` service command (line 59-61). Change:

```yaml
    command: >
      sh -c "python -m app.tasks.prewarm &&
             celery -A app.tasks.celery_app worker --loglevel=info --concurrency=${CELERY_CONCURRENCY:-1}"
```

To:

```yaml
    command: >
      sh -c "python -m app.tasks.prewarm &&
             celery -A app.tasks.celery_app worker -Q heavy --loglevel=info --concurrency=${CELERY_CONCURRENCY:-1}"
```

The only change is adding `-Q heavy` after `worker`.

- [ ] **Step 2: Add the `worker-light` service**

Add a new service after the `worker` service block (after line 76) and before the `beat` service:

```yaml
  worker-light:
    build: ./apps/pipeline
    command: >
      celery -A app.tasks.celery_app worker -Q light
      --loglevel=info --concurrency=${CELERY_LIGHT_CONCURRENCY:-3}
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podlog
      REDIS_URL: redis://redis:6379/0
    volumes:
      - audio_data:/data/audio
      - transcript_data:/data/transcripts
      - model_cache:/root/.cache/huggingface
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      pipeline:
        condition: service_healthy
```

Note: No prewarm step. Same volumes, env vars, and dependency pattern as `worker`.

- [ ] **Step 3: Validate Docker Compose syntax**

Run: `docker compose config --quiet`
Expected: Exits 0 with no output (valid config).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: split worker into heavy and light services in Docker Compose"
```

---

### Task 3: Add `CELERY_LIGHT_CONCURRENCY` to `.env.example`

**Files:**
- Modify: `.env.example:13`

- [ ] **Step 1: Add the new env var**

In `.env.example`, after the `CELERY_CONCURRENCY=1` line (line 13), add:

```
CELERY_LIGHT_CONCURRENCY=3    # Light worker concurrency (downloads, inference, archival)
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add CELERY_LIGHT_CONCURRENCY to .env.example"
```

---

### Task 4: Smoke test with Docker Compose

This task validates the full setup works end-to-end.

- [ ] **Step 1: Rebuild and start services**

Run: `make build && make up`
Expected: All services start including both `worker` and `worker-light`.

- [ ] **Step 2: Verify both workers are running and consuming correct queues**

Run: `docker compose logs worker --tail=20` and `docker compose logs worker-light --tail=20`

Expected in `worker` logs: `connected to: redis://redis:6379/0` and `[queues]` showing only `heavy`.
Expected in `worker-light` logs: `connected to: redis://redis:6379/0` and `[queues]` showing only `light`.

- [ ] **Step 3: Verify in Flower**

Open http://localhost:5555 in a browser. Both workers should appear in the Workers tab — one consuming `heavy`, the other consuming `light`.
