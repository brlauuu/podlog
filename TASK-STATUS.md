# Task Status Report

Generated: 2026-02-25

## Completed Tasks

### Task 7 — Generate lock files (package-lock.json + poetry.lock)

**Status:** Done
**Attempts:** 1 each, with a regeneration of package-lock.json after Task 9 modified package.json.

- `poetry.lock` generated inside a `python:3.11-slim` Docker container (no local Poetry available). 6187 lines.
- `package-lock.json` generated via `npm install --package-lock-only`. Regenerated once after shadcn/ui (Task 9) added radix dependencies to package.json.

### Task 8 — Write first Alembic migration

**Status:** Done
**Attempts:** 1

- Hand-wrote `alembic/versions/001_initial_schema.py` (cannot run autogenerate without a live DB).
- Creates all 4 tables: `feeds`, `episodes`, `segments`, `speaker_names`.
- Includes GIN full-text search index on `segments.text`.

### Task 9 — Initialize shadcn/ui and create components/ui directory

**Status:** Done
**Attempts:** 1

- Created `components.json` and `src/lib/utils.ts` manually.
- Installed 6 components via `npx shadcn@latest add`: button, input, badge, dialog, dropdown-menu, tooltip.
- shadcn updated package.json with resolved `@radix-ui/*` versions.

### Task 10 — Create audio test fixture and flesh out integration tests

**Status:** Done
**Attempts:** 1

- Generated 10-second silent MP3 (81KB) via `jrottenberg/ffmpeg:5-scratch` Docker image.
- Created `tests/conftest.py` with shared fixtures.
- Created `tests/integration/conftest.py` with DB session fixtures (per-test rollback).
- Fleshed out `tests/integration/test_pipeline.py` with 7 real test cases across 3 classes: TestTranscription (2), TestDiarization (2), TestArchive (2+1).
- Updated `tests/e2e/test_full_flow.py` with a real health check test and better stubs.
- Added `e2e` pytest marker to `pyproject.toml`.

## Pending Tasks

### Task 11 — Smoke-test docker compose build

**Status:** Not done
**Attempts:** 3 (pipeline built; web failed twice, fixes applied but final rebuild not run)

**Attempt 1 — Pipeline image:**
- Failed because `poetry install --no-dev` is deprecated in Poetry 1.6+, and Poetry complained about a missing `README.md`.
- **Fix:** Changed Dockerfile to `poetry install --only main --no-root`.
- Rebuilt successfully on second try. Pipeline image confirmed working.

**Attempt 2 — Web image (first try):**
- Failed: `next.config.ts` is not supported by Next.js 14.2.
- **Fix:** Converted `next.config.ts` → `next.config.mjs`.

**Attempt 3 — Web image (second try):**
- Failed: Next.js tried to prerender `/podcasts` at build time, which imports `pg` and connects to PostgreSQL (not available during Docker build).
- **Fix:** Added `export const dynamic = "force-dynamic"` to all 3 Server Component pages that query the DB: `/podcasts/page.tsx`, `/podcasts/[id]/page.tsx`, `/episodes/[id]/page.tsx`.
- The rebuild with these fixes has **not yet been run**.
