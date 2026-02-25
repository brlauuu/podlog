# Podlog — Project Context

## What This Is

Podlog is a self-hosted podcast transcription and search app. It downloads episodes from RSS feeds, transcribes them with Whisper, labels speakers with pyannote, and provides a web UI to search across all transcripts. Single user, local only, runs entirely in Docker.

**Phase:** MVP scaffold is complete. No code has been built and tested end-to-end yet. The first Alembic migration has not been generated.

## Documentation

Detailed specifications live in `prds/`:

| File | Covers |
|---|---|
| `prds/PRD-01-ingestion-pipeline.md` | Pipeline: RSS ingestion, Whisper, pyannote, Celery tasks, error handling, retry logic |
| `prds/PRD-02-search-web-app.md` | Web app: search UI, audio player, queue dashboard, dark mode, speaker renaming |
| `prds/PRD-03-infrastructure.md` | Docker Compose, repo structure, Dockerfiles, CI/CD, Makefile, env vars |
| `prds/RISKS-AND-GAPS.md` | Active risks, known gaps, hardware requirements, resolved items |

When making decisions, reference PRD sections (e.g. "per PRD-01 §5.4") rather than re-deriving. The PRDs are the source of truth for requirements.

## Repo Structure

```
podlog/
├── docker-compose.yml              # Production-like local stack (7 services)
├── docker-compose.test.yml         # Test stack with redis_test, mock_rss
├── .env.example                    # All config vars documented
├── Makefile                        # make up / down / build / test / etc.
├── apps/
│   ├── pipeline/                   # Python 3.11 — FastAPI + Celery
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI app entry point
│   │   │   ├── config.py           # pydantic-settings, all env vars
│   │   │   ├── models.py           # SQLAlchemy ORM (feeds, episodes, segments, speaker_names)
│   │   │   ├── database.py         # Engine + session factory
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health)
│   │   │   ├── tasks/              # Celery tasks (ingest, download, transcribe, diarize, archive, prewarm)
│   │   │   ├── services/           # Business logic (rss, whisper, pyannote, alignment)
│   │   │   └── scheduler.py        # Celery Beat periodic feed polling
│   │   ├── alembic/                # Database migrations
│   │   └── tests/                  # unit, integration, e2e
│   └── web/                        # Next.js 14 (App Router)
│       ├── src/app/                # Pages: /, /podcasts, /episodes/[id], /queue, /feeds
│       ├── src/app/api/            # API routes: search, feeds, queue, audio serving, speaker rename
│       ├── src/components/         # Navbar, AudioPlayer, SearchResult, QueueStatus, etc.
│       └── src/lib/                # db.ts (pg pool), search.ts (FTS query), timestamp.ts
└── prds/                           # Specifications and risk register
```

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Pipeline API | FastAPI (Python 3.11) | Internal API consumed by web app + Celery tasks |
| Task queue | Celery 5 + Redis 7 | Sequential processing (concurrency=1) to avoid OOM |
| Transcription | `openai/whisper-large-v3` via `transformers` | Explicit unload before diarization — mandatory |
| Diarization | `pyannote/speaker-diarization-3.1` | Requires HF_TOKEN; graceful failure path |
| Database | PostgreSQL 15 | FTS via `to_tsvector` + GIN index |
| ORM | SQLAlchemy 2.0 + Alembic | Migrations auto-run on pipeline startup |
| Web app | Next.js 14 (App Router) | `output: 'standalone'` for Docker |
| Styling | Tailwind CSS + shadcn/ui | Dark mode via `class` strategy |
| Data fetching | TanStack React Query | Polling for queue status |
| DB client (web) | `pg` (node-postgres) raw SQL | Direct PostgreSQL queries for search |

## Key Architectural Decisions

- **Whisper and pyannote never in memory simultaneously.** Whisper is explicitly unloaded (+ `gc.collect()`) before pyannote loads. This is mandatory on CPU-only machines. See PRD-01 §5.4.
- **Web app reads DB directly for search** but proxies to the pipeline API for feed management, queue retries, and health checks.
- **Audio serving has path traversal protection.** The `/api/audio/[episodeId]/[filename]` route strips path separators and validates the resolved path stays within `/data/audio/archive/`.
- **Error classification drives retry logic.** `TRANSIENT_NETWORK` and `HTTP_ACCESS` auto-retry (up to 3x with exponential backoff). `DISK_FULL` and `OOM` fail immediately.
- **Diarization failure is non-fatal.** If pyannote fails, the transcript is still written with `speaker_label = NULL` and `has_diarization = false`.

## How to Run

```bash
cp .env.example .env   # Edit: set POSTGRES_PASSWORD and HF_TOKEN
make build             # Build Docker images
make up                # Start all 7 services
make logs              # Follow logs
make test-unit         # Run unit tests
make shell-db          # Open psql shell
```

Services: web (:3000), pipeline API (:8000), Flower (:5555).

## Conventions

- **Python style:** Ruff for linting, 100 char line length, type hints everywhere, structured JSON logging to stdout.
- **TypeScript style:** ESLint + Next.js config, `@/*` path alias for imports, strict mode.
- **Naming:** Display name is "Podlog". Database name is `podlog`. Docker services use short names (db, redis, pipeline, worker, beat, flower, web).
- **Testing:**
  - Pipeline: `pytest` — unit tests mock DB/models, integration tests use a real test DB.
  - Web: `jest` + `@testing-library/react` for unit, `playwright` for e2e.
- **PRD references:** When implementing a feature, cite the PRD section (e.g. "per PRD-02 §5.6") in code comments only where the requirement is non-obvious.
- **When modifying the design:** Update the relevant PRD and RISKS-AND-GAPS.md. Bump the version number and add a changelog entry.

## Current State & What's Next

**Done:**
- Full project scaffold committed (88 files, all services defined)
- SQLAlchemy models with all fields including `updated_at`
- All Celery task implementations (download, transcribe, diarize, archive, prewarm)
- All FastAPI endpoints (feeds, episodes, queue, health)
- All Next.js pages, API routes, and components
- Unit test stubs with real test logic for alignment, RSS, retry, timestamp, path validation

**Not yet done:**
- First Alembic migration (`alembic revision --autogenerate`)
- `npm install` / `poetry lock` (no lock files yet)
- Docker build smoke test
- Integration and e2e tests (stubs exist, bodies are `pytest.skip`)
- `sample.mp3` test fixture not yet created
- shadcn/ui components not yet installed (only radix primitives in package.json)
