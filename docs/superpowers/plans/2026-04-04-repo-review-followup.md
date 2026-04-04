# Repository Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 independent findings from the 2026-04-02 repository review (#104) — missing migration, broken test harness, search contract, notification consistency, audio route, and stale docs.

**Architecture:** Each finding is an independent PR branched from main. No cross-dependencies — merge in any order. All changes are small, targeted fixes to existing code.

**Tech Stack:** Python/SQLAlchemy/Alembic (pipeline), TypeScript/Next.js (web), PostgreSQL, Docker Compose.

---

### Task 1: Add missing `notification_log` migration

**Branch:** `fix/104-notification-log-migration`

**Files:**
- Create: `apps/pipeline/alembic/versions/009_add_notification_log_table.py`

- [ ] **Step 1: Create the migration file**

The `NotificationLog` model is defined at `apps/pipeline/app/models.py:228-245`. The migration must create the table and index to match.

```python
"""Add notification_log table for digest delivery.

The NotificationLog model was added in app/models.py but no migration
created the underlying table. Fixes finding #1 from issue #104.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column(
            "episode_id",
            UUID(as_uuid=False),
            sa.ForeignKey("episodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("sent", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_index(
        "idx_notification_log_unsent",
        "notification_log",
        ["sent", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_notification_log_unsent", table_name="notification_log")
    op.drop_table("notification_log")
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v --tb=short`

Expected: 218 passed (all existing tests still pass).

- [ ] **Step 3: Commit and create PR**

```bash
git checkout -b fix/104-notification-log-migration main
git add apps/pipeline/alembic/versions/009_add_notification_log_table.py
git commit -m "fix: add missing notification_log migration (#104)

The NotificationLog model existed in models.py but had no Alembic
migration, causing digest logging to silently fail at runtime.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-notification-log-migration
gh pr create --title "fix: add missing notification_log migration" --body "$(cat <<'EOF'
## Summary
- Adds migration 009 creating the `notification_log` table and `idx_notification_log_unsent` index
- Matches the `NotificationLog` model in `models.py:228-245`
- Fixes finding #1 from #104 (digest notifications depend on unmigrated table)

## Test plan
- [ ] Existing 218 unit tests pass
- [ ] Migration applies cleanly to test DB (`alembic upgrade head`)

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

---

### Task 2: Fix test harness env var mismatch

**Branch:** `fix/104-test-harness`

**Files:**
- Modify: `docker-compose.test.yml:21-36` (test service env vars)
- Modify: `docker-compose.test.yml:38-47` (web_test service)

- [ ] **Step 1: Fix the env var mismatch**

In `docker-compose.test.yml`, the `test` service sets `DATABASE_URL` but `apps/pipeline/tests/integration/conftest.py:15` expects `TEST_DATABASE_URL`. Add the missing env var:

```yaml
  test:
    build:
      context: ./apps/pipeline
      dockerfile: Dockerfile.worker
      args:
        INSTALL_DEV: "true"
    command: pytest tests/ -v --cov=app --cov-report=term-missing
    environment:
      DATABASE_URL: postgresql://postgres:test@db_test:5432/podlog_test
      TEST_DATABASE_URL: postgresql://postgres:test@db_test:5432/podlog_test
      MOCK_RSS_URL: http://mock_rss/feed.xml
      HF_TOKEN: ${HF_TOKEN:-}
    depends_on:
      db_test:
        condition: service_healthy
      mock_rss:
        condition: service_started
```

- [ ] **Step 2: Fix the broken web_test service**

The `web_test` service references `pipeline_test:8000` which doesn't exist. Since pipeline e2e tests require a running pipeline service that isn't in the test stack, comment out the broken service with an explanation:

```yaml
  # web_test: disabled until a pipeline_test service is added to the test stack.
  # The Playwright tests require a running pipeline API which is not yet available
  # in the test composition. See issue #104 finding #2.
  # web_test:
  #   build: ./apps/web
  #   command: npx playwright test
  #   environment:
  #     DATABASE_URL: postgresql://postgres:test@db_test:5432/podlog_test
  #     PIPELINE_API_URL: http://pipeline_test:8000
  #   depends_on:
  #     db_test:
  #       condition: service_healthy
```

- [ ] **Step 3: Rebuild and verify integration tests run**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/ -v --tb=short`

Expected: Unit tests pass. Integration tests should now attempt to run (not skip with "TEST_DATABASE_URL not set"). Some integration tests may still skip due to missing fixtures (e.g., `FIXTURE_AUDIO`), which is expected.

- [ ] **Step 4: Commit and create PR**

```bash
git checkout -b fix/104-test-harness main
git add docker-compose.test.yml
git commit -m "fix: add TEST_DATABASE_URL to test stack, disable broken web_test (#104)

Integration tests were always skipped because docker-compose.test.yml
set DATABASE_URL but conftest.py expected TEST_DATABASE_URL. Also
disabled web_test service that references nonexistent pipeline_test.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-test-harness
gh pr create --title "fix: repair test harness env vars and broken service" --body "$(cat <<'EOF'
## Summary
- Adds `TEST_DATABASE_URL` env var to test service in docker-compose.test.yml
- Disables broken `web_test` service that references nonexistent `pipeline_test`
- Integration tests now actually run instead of silently skipping
- Fixes finding #2 from #104

## Test plan
- [ ] Unit tests still pass (218)
- [ ] Integration tests attempt to run (not skip with "TEST_DATABASE_URL not set")

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

---

### Task 3: Fix feedless episodes excluded from search

**Branch:** `fix/104-feedless-search`

**Files:**
- Modify: `apps/web/src/lib/search.ts:189-190` (searchSegments FTS query)
- Modify: `apps/web/src/lib/search.ts:223-224` (searchSegments vector query)
- Modify: `apps/web/src/lib/search.ts:241-242` (searchSegments count query)
- Modify: `apps/web/src/lib/search.ts:361-362` (searchGrouped rows query)
- Modify: `apps/web/src/lib/search.ts:381-382` (searchGrouped count query)

- [ ] **Step 1: Change all INNER JOINs on feeds to LEFT JOINs**

In `apps/web/src/lib/search.ts`, there are 5 queries that use `JOIN feeds f ON e.feed_id = f.id`. Change each to `LEFT JOIN feeds f ON e.feed_id = f.id` and wrap feed field references in COALESCE:

In `searchSegments` FTS query (line 190):
```
    JOIN feeds f ON e.feed_id = f.id
```
becomes:
```
    LEFT JOIN feeds f ON e.feed_id = f.id
```

Same change in these locations:
- Line 224: `searchSegments` vector query
- Line 242: `searchSegments` count query
- Line 362: `searchGrouped` rows query
- Line 382: `searchGrouped` count query

- [ ] **Step 2: Add COALESCE fallbacks for feed fields**

In the `searchSegments` FTS query (lines 185-187), change:
```sql
      f.title AS feed_title,
      f.mode AS feed_mode,
      f.id AS feed_id
```
to:
```sql
      COALESCE(f.title, 'Manual episode') AS feed_title,
      COALESCE(f.mode, 'full') AS feed_mode,
      f.id AS feed_id
```

Apply the same COALESCE pattern in:
- `searchSegments` vector query (lines 219-221)
- `searchGrouped` rows query (lines 350-352)

For the feed filter clause `AND ($2::uuid IS NULL OR f.id = $2)`, this already handles NULL correctly — if `feedId` is NULL the filter is skipped, and feedless episodes have `f.id = NULL` which won't match a specific feed filter. No change needed.

- [ ] **Step 3: Handle null feedId in searchGrouped grouping**

In `searchGrouped` (line 366), the `GROUP BY` includes `f.id`. For feedless episodes, `f.id` will be NULL. This groups all feedless episodes together, which is reasonable behavior. The `feedMap` key on line 395 uses `row.feed_id` — for feedless episodes this is NULL. Update the key to handle null:

At line 395 of `search.ts`, change:
```typescript
    const feedKey = row.feed_id;
```
to:
```typescript
    const feedKey = row.feed_id ?? "__manual__";
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v --tb=short`

Expected: 218 passed. (Web-side changes are SQL-only and don't have unit tests — they'll be verified by the existing search UI.)

- [ ] **Step 5: Commit and create PR**

```bash
git checkout -b fix/104-feedless-search main
git add apps/web/src/lib/search.ts
git commit -m "fix: include feedless episodes in search results (#104)

Changed JOIN feeds to LEFT JOIN feeds in all search queries so manually
ingested episodes (with NULL feed_id) appear in results. Added COALESCE
fallbacks for feed title and mode.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-feedless-search
gh pr create --title "fix: include feedless episodes in search results" --body "$(cat <<'EOF'
## Summary
- Changes `JOIN feeds` to `LEFT JOIN feeds` in all 5 search queries
- Adds `COALESCE(f.title, 'Manual episode')` fallback for feed title
- Handles null feed_id grouping key in searchGrouped
- Fixes finding #3 from #104

## Test plan
- [ ] Existing tests pass
- [ ] Manually ingested episodes appear in search results

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

---

### Task 4: Normalize terminal failure notification emission

**Branch:** `fix/104-download-mark-failed`

**Files:**
- Modify: `apps/pipeline/app/tasks/download.py:18,46-54,96-111,114-121,190-203`

- [ ] **Step 1: Import mark_failed instead of update_episode**

At `apps/pipeline/app/tasks/download.py:18`, change:
```python
from app.tasks.helpers import update_episode as _update_episode
```
to:
```python
from app.tasks.helpers import mark_failed, update_episode as _update_episode
```

- [ ] **Step 2: Replace direct failure writes with mark_failed**

There are 4 terminal failure paths in `download.py` that write `status="failed"` directly via `_update_episode`. Replace each with `mark_failed`:

**Disk full pre-check (lines 46-54):**
```python
                _update_episode(
                    db,
                    episode_id,
                    status="failed",
                    error_class="DISK_FULL",
                    error_message=(
                        f"Insufficient disk space. Need {needed_gb:.1f} GB free before download."
                    ),
                )
```
becomes:
```python
                mark_failed(
                    db,
                    episode_id,
                    error_class="DISK_FULL",
                    error_message=(
                        f"Insufficient disk space. Need {needed_gb:.1f} GB free before download."
                    ),
                )
```

**Disk full during download (lines 96-102):**
```python
                _update_episode(
                    db,
                    episode_id,
                    status="failed",
                    error_class="DISK_FULL",
                    error_message="Disk full during download. Free space and retry.",
                )
```
becomes:
```python
                mark_failed(
                    db,
                    episode_id,
                    error_class="DISK_FULL",
                    error_message="Disk full during download. Free space and retry.",
                )
```

**OS error (lines 105-111):**
```python
            _update_episode(
                db,
                episode_id,
                status="failed",
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
```
becomes:
```python
            mark_failed(
                db,
                episode_id,
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
```

**Generic exception (lines 114-121):**
```python
            _update_episode(
                db,
                episode_id,
                status="failed",
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
```
becomes:
```python
            mark_failed(
                db,
                episode_id,
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
```

**Retries exhausted in _handle_transient_failure (lines 191-203):**
```python
        _update_episode(
            db,
            episode_id,
            status="failed",
            retry_count=new_count,
            error_class=error_class,
            error_message=f"Failed after {retry_max} retries: {error_msg}",
        )
        logger.error(
            '"action": "permanent_failure", "episode_id": "%s", "error_class": "%s"',
            episode_id,
            error_class,
        )
```
becomes:
```python
        _update_episode(db, episode_id, retry_count=new_count)
        mark_failed(
            db,
            episode_id,
            error_class=error_class,
            error_message=f"Failed after {retry_max} retries: {error_msg}",
        )
```

Note: `mark_failed` already sets `status="failed"`, logs the error, and emits `EpisodeFailedEvent`. The separate `_update_episode` call for `retry_count` is needed because `mark_failed` doesn't accept arbitrary kwargs.

- [ ] **Step 3: Run tests to verify no regressions**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v --tb=short`

Expected: 218 passed.

- [ ] **Step 4: Commit and create PR**

```bash
git checkout -b fix/104-download-mark-failed main
git add apps/pipeline/app/tasks/download.py
git commit -m "fix: use mark_failed in download task for consistent notifications (#104)

Download task was writing status='failed' directly via update_episode,
bypassing mark_failed and its EpisodeFailedEvent emission. Terminal
download failures (disk full, system error) now emit notifications.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-download-mark-failed
gh pr create --title "fix: normalize download failure notifications" --body "$(cat <<'EOF'
## Summary
- Replaces direct `status="failed"` writes in download.py with `mark_failed()`
- All 5 terminal failure paths now emit `EpisodeFailedEvent` for notifications
- Fixes finding #4 from #104

## Test plan
- [ ] Existing 218 unit tests pass
- [ ] Download failure notification tests pass

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

---

### Task 5: Tighten audio route contract

**Branch:** `fix/104-audio-route`

**Files:**
- Modify: `apps/web/src/app/api/audio/[episodeId]/[filename]/route.ts`

- [ ] **Step 1: Add episodeId validation and content type detection**

Replace the full content of `apps/web/src/app/api/audio/[episodeId]/[filename]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import pool from "@/lib/db";

const AUDIO_DIRS = ["/data/audio/archive", "/data/audio/raw"];

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
};

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? "audio/mpeg";
}

/**
 * Serve audio files with path traversal prevention — PRD-02 §5.2, §11
 *
 * Checks archive first, then raw (for episodes not yet archived).
 *
 * Security:
 * - filename parameter is treated as basename only (path separators stripped)
 * - Resolved path is verified to stay within allowed directories
 * - episodeId is validated against the database
 * - Any path that escapes the audio directories returns HTTP 400
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { episodeId: string; filename: string } }
) {
  const { episodeId } = params;

  // Validate episode exists and the file belongs to it
  const epResult = await pool.query(
    "SELECT audio_local_path FROM episodes WHERE id = $1",
    [episodeId]
  );
  if (epResult.rows.length === 0) {
    return new NextResponse("Episode not found", { status: 404 });
  }

  // Strip any path separators — treat filename as basename only
  const safeName = path.basename(params.filename);

  // Verify the requested filename matches the episode's audio file
  const episodePath = epResult.rows[0].audio_local_path;
  if (episodePath && path.basename(episodePath) !== safeName) {
    return new NextResponse("File does not belong to this episode", { status: 404 });
  }

  // Find the file in archive or raw directories
  let resolved: string | null = null;
  for (const dir of AUDIO_DIRS) {
    const candidate = path.resolve(dir, safeName);
    if (!candidate.startsWith(dir + path.sep)) continue;
    if (fs.existsSync(candidate)) {
      resolved = candidate;
      break;
    }
  }

  if (!resolved) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stat = fs.statSync(resolved);
  const fileSize = stat.size;
  const contentType = getContentType(resolved);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(resolved, { start, end });
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(readableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
      },
    });
  }

  const stream = fs.createReadStream(resolved);
  const readableStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readableStream, {
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    },
  });
}
```

- [ ] **Step 2: Run tests to verify no regressions**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v --tb=short`

Expected: 218 passed. (Audio route is in the web app, not pipeline — pipeline tests should be unaffected.)

- [ ] **Step 3: Commit and create PR**

```bash
git checkout -b fix/104-audio-route main
git add apps/web/src/app/api/audio/\[episodeId\]/\[filename\]/route.ts
git commit -m "fix: validate episodeId and detect content type in audio route (#104)

The audio route ignored episodeId entirely and hardcoded audio/mpeg.
Now validates the episode exists and the file belongs to it, and
derives content type from the file extension.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-audio-route
gh pr create --title "fix: tighten audio route contract" --body "$(cat <<'EOF'
## Summary
- Validates episodeId against database, returns 404 if not found
- Verifies requested filename matches episode's audio_local_path
- Detects content type from file extension (mp3, m4a, ogg, wav, flac, opus, aac, wma)
- Fixes finding #5 from #104

## Test plan
- [ ] Existing tests pass
- [ ] Audio playback works in the UI (manual verification)
- [ ] Non-MP3 files served with correct content type

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

---

### Task 6: Update stale CLAUDE.md

**Branch:** `fix/104-stale-docs`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md to reflect current state**

The following sections need updates. Read the current `CLAUDE.md`, then apply these changes:

**Phase section (near top):** Change:
```
**Phase:** MVP scaffold is complete. No code has been built and tested end-to-end yet. The first Alembic migration has not been generated.
```
to:
```
**Phase:** Core pipeline is operational. Episodes are being ingested, transcribed, diarized, chunked, and archived. 218+ unit tests pass. 9 Alembic migrations applied. Web UI serves search, queue dashboard, and feed management.
```

**Repo structure comments:** Change:
```
│   ├── pipeline/                   # Python 3.11 — FastAPI + Celery
```
to:
```
│   ├── pipeline/                   # Python 3.11 — FastAPI + DB-backed job queue
```

Change:
```
│   │   │   ├── tasks/              # Celery tasks (ingest, download, transcribe, diarize, archive, prewarm)
```
to:
```
│   │   │   ├── tasks/              # Pipeline tasks (ingest, download, transcribe, diarize, chunk, embed, infer, archive)
```

Change:
```
│   │   │   └── scheduler.py        # Celery Beat periodic feed polling
```
to:
```
│   │   │   └── scheduler.py        # Periodic feed polling
```

Change:
```
├── docker-compose.test.yml         # Test stack with redis_test, mock_rss
```
to:
```
├── docker-compose.test.yml         # Test stack with db_test, mock_rss
```

**Tech stack table:** Change:
```
| Pipeline API | FastAPI (Python 3.11) | Internal API consumed by web app + Celery tasks |
| Task queue | Celery 5 + Redis 7 | Sequential processing (concurrency=1) to avoid OOM |
```
to:
```
| Pipeline API | FastAPI (Python 3.11) | Internal API consumed by web app |
| Task queue | PostgreSQL-backed job queue | Sequential processing (concurrency=1) to avoid OOM |
```

**Services line:** Change:
```
Services: web (:3000), pipeline API (:8000), Flower (:5555).
```
to:
```
Services: web (:3000), pipeline API (:8000).
```

**Naming line:** Change:
```
- **Naming:** Display name is "Podlog". Database name is `podlog`. Docker services use short names (db, redis, pipeline, worker, beat, flower, web).
```
to:
```
- **Naming:** Display name is "Podlog". Database name is `podlog`. Docker services use short names (db, pipeline, worker, web).
```

**Done section:** Change:
```
- All Celery task implementations (download, transcribe, diarize, archive, prewarm)
```
to:
```
- All pipeline task implementations (download, transcribe, diarize, chunk, embed, infer, archive)
```

**Not yet done section:** Change:
```
**Not yet done:**
- First Alembic migration (`alembic revision --autogenerate`)
- `npm install` / `poetry lock` (no lock files yet)
- Docker build smoke test
- Integration and e2e tests (stubs exist, bodies are `pytest.skip`)
- `sample.mp3` test fixture not yet created
- shadcn/ui components not yet installed (only radix primitives in package.json)
```
to:
```
**Not yet done:**
- Integration and e2e test bodies (stubs exist, some skipped)
- Full end-to-end pipeline smoke test in CI
- shadcn/ui component library (using radix primitives directly)
```

**PRD table description:** Change:
```
| `prds/PRD-01-ingestion-pipeline.md` | Pipeline: RSS ingestion, Whisper, pyannote, Celery tasks, error handling, retry logic |
```
to:
```
| `prds/PRD-01-ingestion-pipeline.md` | Pipeline: RSS ingestion, Whisper, pyannote, task queue, error handling, retry logic |
```

- [ ] **Step 2: Commit and create PR**

```bash
git checkout -b fix/104-stale-docs main
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect current project state (#104)

Removed references to Celery/Redis/Flower (replaced by DB-backed job
queue), updated phase description, task list, and 'not yet done' section
to match the actual state of the codebase.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin fix/104-stale-docs
gh pr create --title "docs: update stale CLAUDE.md to current reality" --body "$(cat <<'EOF'
## Summary
- Updates phase description (no longer scaffold-only)
- Replaces Celery/Redis/Flower references with PostgreSQL-backed job queue
- Updates task list to include chunk/embed/infer steps
- Refreshes "Done" and "Not yet done" sections
- Fixes finding #6 from #104

## Test plan
- [ ] Documentation review — no code changes

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```
