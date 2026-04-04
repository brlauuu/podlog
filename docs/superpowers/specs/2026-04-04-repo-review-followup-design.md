# Issue #104: Repository Review Follow-up

Date: 2026-04-04

## Overview

Six independent fixes addressing findings from the 2026-04-02 repository review. Each finding gets its own PR, merged in order.

## PR 1 — Add missing `notification_log` migration

**Problem:** The `NotificationLog` model exists in `models.py` but no Alembic migration creates the table. Digest logging silently fails at runtime because the event bus swallows handler exceptions.

**Fix:**
- New migration `009_add_notification_log_table.py` using Alembic typed helpers
- Columns: `id` (serial PK), `event_type` (text), `episode_id` (UUID FK to episodes), `payload` (text), `sent` (boolean, default false), `created_at` (timestamptz, default now())
- Index: `idx_notification_log_unsent` on `(sent, created_at)` matching the model definition

**Files:** `apps/pipeline/alembic/versions/009_add_notification_log_table.py`

## PR 2 — Fix test harness env var mismatch

**Problem:** `docker-compose.test.yml` sets `DATABASE_URL` but integration test conftest expects `TEST_DATABASE_URL`. The `web_test` service references a nonexistent `pipeline_test` service.

**Fix:**
- Add `TEST_DATABASE_URL` env var to the `test` service in `docker-compose.test.yml`, pointing to `db_test`
- Fix or remove the `web_test` service's broken `pipeline_test` dependency
- Verify integration tests run (not just skip) after the fix

**Files:** `docker-compose.test.yml`, possibly `apps/pipeline/tests/integration/conftest.py`

## PR 3 — Fix feedless episodes excluded from search

**Problem:** `search.ts` uses `JOIN feeds f ON e.feed_id = f.id` which drops episodes with NULL `feed_id` (manually ingested episodes).

**Fix:**
- Change `JOIN feeds` to `LEFT JOIN feeds` in both `searchSegments()` and `searchGrouped()`
- Use `COALESCE(f.title, 'Manual episode')` as fallback label where feed title is referenced

**Files:** `apps/web/src/lib/search.ts`

## PR 4 — Normalize terminal failure notification emission

**Problem:** `download.py` writes `status="failed"` directly instead of calling `mark_failed()`, so terminal download failures never emit `EpisodeFailedEvent` for notifications.

**Fix:**
- Replace direct `_update_episode(db, episode_id, status="failed", ...)` calls in `download.py` with `mark_failed(db, episode_id, error_class, error_message)` from `helpers.py`
- This ensures all terminal failures across all tasks consistently emit failure notifications

**Files:** `apps/pipeline/app/tasks/download.py`

## PR 5 — Tighten audio route contract

**Problem:** The audio route ignores the `episodeId` parameter entirely and hardcodes `Content-Type: audio/mpeg` regardless of actual file format.

**Fix:**
- Query the database to verify the requested file belongs to the given `episodeId`
- Return 404 if the episode doesn't exist or the file doesn't match
- Derive content type from file extension (`.mp3` -> `audio/mpeg`, `.m4a` -> `audio/mp4`, `.ogg` -> `audio/ogg`, etc.) with `audio/mpeg` as fallback

**Files:** `apps/web/src/app/api/audio/[episodeId]/[filename]/route.ts`

## PR 6 — Update stale CLAUDE.md

**Problem:** CLAUDE.md still describes scaffold-only state, references Celery/Redis/Flower, and says "first Alembic migration has not been generated" when 9 migrations exist.

**Fix:**
- Update "Phase" description to reflect current state (pipeline running, 218+ unit tests passing)
- Update "Tech Stack" table: replace Celery/Redis with PostgreSQL-backed job queue
- Update "Current State" section: move completed items to "Done", update "Not yet done"
- Remove references to Flower (:5555) if no longer in use
- Keep the section structure intact — just update facts

**Files:** `CLAUDE.md`

## Implementation Order

PRs should be merged in order (1-6) as the issue recommends, but they are independent and can be implemented in parallel.

## Testing

- PR 1: Verify migration runs cleanly against test DB; existing digest unit tests continue to pass
- PR 2: Integration tests run instead of skipping; `make test` exercises them
- PR 3: Manual episodes appear in search results
- PR 4: Existing notification unit tests pass; download failure paths tested
- PR 5: Audio route returns 404 for mismatched episodeId; correct content types served
- PR 6: No code changes — documentation review only
