# Podlog — Project Context

## What This Is

Podlog is a self-hosted podcast transcription and search app. It downloads episodes from RSS feeds, transcribes them with Whisper, labels speakers with pyannote, and provides a web UI to search across all transcripts. Supports local-only operation or remote inference via Fireworks AI. Production runs in Docker Compose; development can run services natively (see `docs/development.md`).

**Phase:** Core pipeline is operational. Episodes are being ingested, transcribed, diarized, chunked, and archived. The repo has an active automated test suite and Alembic migration history. Web UI serves search, queue dashboard, feed management, and an Ask AI feature.

## Documentation

Detailed specifications live in `prds/`:

| File | Covers |
|---|---|
| `prds/PRD-01-ingestion-pipeline.md` | Pipeline: RSS ingestion, Whisper, pyannote, task queue, error handling, retry logic |
| `prds/PRD-02-search-web-app.md` | Web app: search UI, audio player, queue dashboard, dark mode, speaker renaming |
| `prds/PRD-03-infrastructure.md` | Docker Compose, repo structure, Dockerfiles, CI/CD, Makefile, env vars |
| `prds/PRD-04-host-guest-inference.md` | Host/guest speaker name inference via NER |
| `prds/RISKS-AND-GAPS.md` | Active risks, known gaps, hardware requirements, resolved items |

When making decisions, reference PRD sections (e.g. "per PRD-01 §5.4") rather than re-deriving. The PRDs are the source of truth for requirements.

## Repo Structure

```
podlog/
├── docker-compose.yml              # Production-like local stack (5 services)
├── docker-compose.remote.yml       # Overlay for remote-inference (Fireworks) profile
├── docker-compose.test.yml         # Test stack (db_test, mock_rss, pipeline_test, web_test, test runner)
├── .env.example                    # All config vars documented
├── Makefile                        # make up / down / build / test / etc.
├── AGENTS.md
├── README.md
├── VERSION
├── LICENSE
├── .node-version                   # Node version for local dev
├── .nvmrc                          # Node version for nvm users
├── .github/                        # GitHub Actions workflows (ci, ci-full-unit, ci-slow)
├── .agents/                        # Agent configuration
├── .superpowers/                   # Superpowers metadata (gitignored)
├── .omx/                           # Oh-my-codex metadata (gitignored)
├── issues/                         # Local issue drafts / notes
├── apps/
│   ├── pipeline/                   # Python 3.11 — FastAPI + DB-backed job queue
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI app entry point
│   │   │   ├── config.py           # pydantic-settings, all env vars
│   │   │   ├── models.py           # SQLAlchemy ORM (feeds, episodes, segments, speaker_names)
│   │   │   ├── database.py         # Engine + session factory
│   │   │   ├── job_queue.py        # PostgreSQL-backed job queue (enqueue, claim, complete)
│   │   │   ├── task_registry.py    # Maps pipeline stages to task functions + next-stage routing
│   │   │   ├── worker.py           # Background job worker + feed polling loop
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health, ask, embed, backfill, notifications, hardware)
│   │   │   ├── tasks/              # Pipeline tasks (ingest, download, transcribe, transcribe_helpers, diarize, chunk, embed, infer, archive, cleanup, prewarm, backfill_chunks, helpers)
│   │   │   └── services/           # Business logic (rss, whisper, pyannote, alignment, chunking, embed, rag, inference, inference_helpers, notifications, notification_events, notification_runtime, notification_settings, digest, digest_formatters, events, hardware, fireworks_audio, pipeline_commands, timing_labels)
│   │   ├── alembic/                # Database migrations (12 versions)
│   │   └── tests/                  # unit, integration, e2e
│   └── web/                        # Next.js 16 (App Router)
│       ├── Dockerfile              # Production image (standalone output)
│       ├── Dockerfile.test         # Test image used by docker-compose.test.yml
│       ├── src/app/                # Pages: /, /about, /podcasts, /podcasts/[id], /episodes/[id], /queue, /feeds, /ask, /search, /search/print, /settings, /docs (and /notifications redirects to /settings)
│       ├── src/app/api/            # API routes: search (search, grouped, mentions, speakers), feeds (CRUD, preview, poll), queue, audio, ask/coverage, episodes ([id], ingest, upload, retry, speakers, speakers/merge), docs, hardware, notifications (settings, test), pipeline (ask, embed, health, queue/retry)
│       ├── src/components/         # Navbar, AudioPlayer, SearchResult, QueueStatus, DocsClient, etc.
│       └── src/lib/                # db.ts, search.ts, search/ (feedFilter, filters, grouping, queryParser, speakerTurns, types), searchHybrid.ts, timestamp.ts, pipeline.ts, types.ts, utils.ts, speakerColors.ts, validateMergeRequest.ts, citations.tsx, episode-link.ts, page-state.ts, queueStatus.ts
├── docs/                           # User-facing documentation and guides
├── scripts/                        # Operational scripts (nightly audit, health check)
└── prds/                           # Specifications and risk register
```

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Pipeline API | FastAPI (Python 3.11) | Internal API consumed by web app |
| Task queue | PostgreSQL-backed job queue | Sequential processing (concurrency=1) to avoid OOM |
| Transcription | WhisperX (CTranslate2 backend), default `large-v3-turbo` | Explicit unload before diarization — mandatory |
| Diarization | `pyannote/community-1` (override via `PYANNOTE_MODEL`) | Requires HF_TOKEN; graceful failure path |
| LLM inference | Ollama (local) or Fireworks AI (remote) | RAG-based Ask AI feature; provider selected via `inference_provider` config; model selected in Ask UI per request |
| Database | PostgreSQL 15 (pgvector/pgvector:pg15) | FTS via `to_tsvector` + GIN index, vector HNSW index |
| ORM | SQLAlchemy 2.0 + Alembic | Migrations auto-run on pipeline startup |
| Web app | Next.js 16 (App Router) | `output: 'standalone'` for Docker |
| Styling | Tailwind CSS + shadcn/ui | Dark mode via `class` strategy; shadcn/ui component set is installed |
| Data fetching | TanStack React Query + fetch/setInterval | React Query for search/coverage data; queue status uses `fetch` polling in `QueueStatus.tsx` |
| DB client (web) | `pg` (node-postgres) raw SQL | Direct PostgreSQL queries for search |

## Key Architectural Decisions

- **Whisper and pyannote never in memory simultaneously.** Whisper is explicitly unloaded (+ `gc.collect()`) before pyannote loads. This is mandatory on CPU-only machines. See PRD-01 §5.4.
- **Web app reads DB directly for search** but proxies to the pipeline API for feed management, queue retries, and health checks.
- **Audio serving has path traversal protection.** The `/api/audio/[episodeId]/[filename]` route strips path separators and validates the resolved path stays within allowed audio directories (`/data/audio/archive/` and `/data/audio/raw/`).
- **Error classification drives retry logic.** `TRANSIENT_NETWORK` and `HTTP_ACCESS` auto-retry (up to 3x with exponential backoff). `DISK_FULL` and `OOM` fail immediately.
- **Diarization failure is non-fatal.** If pyannote fails, the transcript is still written with `speaker_label = NULL` and `has_diarization = false`.

## How to Run

```bash
cp .env.example .env   # Edit: set POSTGRES_PASSWORD and HF_TOKEN
make build             # Build Docker images
make up                # Start all 5 services
make logs              # Follow logs
make test-unit         # Run pipeline unit tests + host healthcheck test (no web unit tests)
make shell-db          # Open psql shell
```

Services: web (:3000), pipeline API (:8000), ollama (:11434).

## Conventions

- **Python style:** Ruff for linting, 100 char line length, type hints everywhere, structured JSON logging to stdout.
- **TypeScript style:** ESLint + Next.js config, `@/*` path alias for imports, strict mode.
- **Naming:** Display name is "Podlog". Database name is `podlog`. Docker services use short names (db, pipeline, worker, ollama, web).
- **Testing:**
  - Pipeline: `pytest` — unit tests mock DB/models, integration tests use a real test DB.
  - Web: `jest` + `@testing-library/react` for unit, `playwright` for e2e.
- **PRD references:** When implementing a feature, cite the PRD section (e.g. "per PRD-02 §5.6") in code comments only where the requirement is non-obvious.
- **When modifying the design:** Update the relevant PRD and RISKS-AND-GAPS.md. Bump the version number.

## Current State & What's Next

**Done:**
- Full pipeline: ingest, download, transcribe, diarize, chunk, embed, infer, archive
- All FastAPI endpoints (feeds, episodes, queue, health, ask, notifications, backfill)
- All Next.js pages, API routes, and components (search, ask, queue, feeds, episodes, notifications)
- Automated test suites for pipeline and web are maintained in-repo
- Alembic migration history is maintained under `apps/pipeline/alembic/versions/`
- shadcn/ui component set is installed and used in the web app
- Docs tab for user documentation
- RAG-based Ask AI feature via Ollama (local) or Fireworks AI (remote)
- Speaker merge/rename UI
- Notification settings

**Not yet done:**
- Full end-to-end pipeline smoke test in CI
- Test coverage thresholds not yet enforced in CI
