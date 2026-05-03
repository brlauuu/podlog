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
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health, ask, embed, backfill, notifications, hardware, meta_analysis)
│   │   │   ├── tasks/              # Pipeline tasks (ingest, download, transcribe, transcribe_helpers, diarize, chunk, embed, infer, archive, cleanup, prewarm, backfill_chunks, helpers)
│   │   │   └── services/           # Business logic (rss, whisper, pyannote, pyannote_cloud, alignment, chunking, embed, rag, inference, inference_helpers, meta_analysis, notifications, notification_events, notification_runtime, notification_settings, digest, digest_formatters, events, hardware, fireworks_audio, pipeline_commands, timing_labels)
│   │   ├── alembic/                # Database migrations (17 versions)
│   │   └── tests/                  # unit, integration, e2e
│   └── web/                        # Next.js 16 (App Router)
│       ├── Dockerfile              # Production image (standalone output)
│       ├── Dockerfile.test         # Test image used by docker-compose.test.yml
│       ├── src/app/                # Pages: /, /about, /podcasts, /podcasts/[id], /episodes/[id], /queue, /feeds, /ask, /search, /search/print, /settings, /docs, /meta-analysis (and /notifications redirects to /settings); DocsClient lives in app/docs/
│       ├── src/app/api/            # API routes: search (search, grouped, mentions, speakers), feeds (CRUD, preview, poll), queue, audio, ask/coverage, episodes ([id], ingest, upload, retry, speakers, speakers/merge), docs, hardware, notifications (settings, test), meta-analysis (coverage, refresh, snapshot), pipeline (ask, embed, health, queue/retry)
│       ├── src/components/         # Navbar, AudioPlayer, SearchResult, QueueStatus, etc.
│       └── src/lib/                # db.ts, search.ts, search/ (coverage, embedding, feedFilter, filters, filterOpts, grouped, grouping, mentions, queryParser, segments, speakerTurns, types), searchHybrid.ts, timestamp.ts, pipeline.ts, types.ts, utils.ts, speakerColors.ts, validateMergeRequest.ts, citations.tsx, episode-link.ts, filename.ts, metaAnalysisColors.ts, metaAnalysisStale.ts, metaAnalysisTypes.ts, normalizeName.ts, page-state.ts, queueStatus.ts, rag-models.ts
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
| Diarization | `pyannote/speaker-diarization-community-1` local (override via `PYANNOTE_MODEL`) or pyannote.ai cloud `precision-2` (`DIARIZATION_PROVIDER=precision2`, Issue #516) | Requires HF_TOKEN for local or `PYANNOTE_API_KEY` for cloud; graceful failure path |
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
- **Changelog:** PRs that ship user-visible behavior add a one-line entry to `CHANGELOG.md` under `## Unreleased`, grouped as Major / Minor / Fixes (or Internal where appropriate). Version headings are bare semver (`## 0.3.0 — 2026-04-24`), not the keepachangelog reference-link form (`## [0.3.0]`) — the latter breaks the About-page anchor lookup (#644). The same file is rendered at the bottom of `/about` in the web app, so write entries for a human reading them there.

## Operational Gotchas

Lessons from active development. Short rules; rationale linked to the incident or PRD section that proved them.

- **Test images bake test files at build time.** Both `apps/pipeline/Dockerfile.worker` (used by `test`) and `apps/web/Dockerfile.test` do `COPY . .`, so editing a test file and re-running `docker compose -f docker-compose.test.yml run --rm test/web_test` executes the OLD copy. Rebuild the test image (`docker compose -f docker-compose.test.yml build test web_test`) after any test edit. Symptom: test count stays the same after adding cases.

- **Use `gen_random_uuid()` without `::text` cast in raw SQL.** All `id` / `feed_id` / `last_seen_episode_id` columns are PostgreSQL `uuid` (declared via `sa.dialects.postgresql.UUID(as_uuid=False)`). Casting to text and inserting into a uuid column raises `DatatypeMismatch` and halts pipeline boot at `alembic upgrade head`. Match the pattern from `001_initial_schema.py`: `server_default = sa.text("gen_random_uuid()")`. This bit us in migration 014 — caught only on first prod restart, not in unit tests.

- **Worker is non-interruptible; verify queue is drained before restart.** `concurrency=1` and in-flight jobs can take minutes. Before `docker compose up -d worker`, run `docker compose exec -T db psql -U postgres podlog -c "SELECT task, status, COUNT(*) FROM job_queue WHERE status IN ('pending','running') GROUP BY task, status;"` and confirm 0 rows. For idle periods this is fast; otherwise wait or use `docker compose stop -t 60 worker` for graceful shutdown.

- **Smoke-test migrations against a real DB before merging.** Unit tests mock the DB so SQL type errors (like the UUID cast above) pass tests and only surface when `alembic upgrade head` runs on a real PostgreSQL in `docker compose up`. Before merging a migration PR, at minimum do `docker compose build pipeline && docker compose up -d pipeline` and check the logs, or run the migration against `db_test` via the test stack.

- **When a dependency's shape changes, rewrite its mocks — don't just update the tests.** The `episodes-speakers-route` test mocked `pool.query` directly. When the route switched to `pool.connect()` for a transaction, the mock shape no longer matched the code, and the tests' "pass" was meaningless. Follow the `speaker-merge-route.test.ts` pattern: mock `pool.connect()` returning a fake client with `query`/`release`, assert `BEGIN`/`COMMIT`/`ROLLBACK` ordering explicitly.

- **Cross-runtime helpers (TS + Python) must stay in lockstep.** When a normalization / canonicalization rule is duplicated across `apps/pipeline/` and `apps/web/`, give each copy a test suite that enumerates the same cases, and cross-reference the files in comments. `apps/web/src/lib/normalizeName.ts` ↔ `apps/pipeline/app/services/inference_helpers.py::normalize_name` is the pattern. Silent divergence corrupts shared DB keys (e.g. `normalized_name` cache column).

- **Self-reinforcement analysis is a design concern for any feature that queries its own prior output.** Two patterns we've used (PRD-04): (a) emit at MEDIUM confidence so the rule's output rows can't satisfy the HIGH filter on the next cycle (`recurring_host`); (b) sever the data source so inference never writes to the table the heuristic reads (`feed_speaker_cache` is populated only from user renames). The `METADATA_SOURCES` frozenset is the mechanism that lets pre-classified candidates bypass heuristic reclassification.

- **Split large issues into sequential PRs, not one bundle.** Issue #523 was shipped as 5 PRs (#525, #526, #527, #529, #531 + hotfix #532). Each PR had its own review / merge / prod-smoke loop. The hotfix pattern (#532 as a 2-line follow-up to #531) is cheaper than reverting or force-pushing over a merged PR.

## Current State & What's Next

**Done:**
- Full pipeline: ingest, download, transcribe, diarize, chunk, embed, infer, archive
- All FastAPI endpoints (feeds, episodes, queue, health, ask, notifications, backfill, meta-analysis)
- All Next.js pages, API routes, and components (search, ask, queue, feeds, episodes, notifications, meta-analysis)
- Automated test suites for pipeline and web are maintained in-repo
- Alembic migration history is maintained under `apps/pipeline/alembic/versions/`
- shadcn/ui component set is installed and used in the web app
- Docs tab for user documentation
- RAG-based Ask AI feature via Ollama (local) or Fireworks AI (remote)
- Speaker merge/rename UI
- Notification settings
- pyannote.ai Precision-2 cloud diarization as an alternative to local pyannote (Issue #516)
- Meta-Analysis dashboard aggregating cross-feed metrics (Issue #521)
- CI enforces coverage thresholds: pipeline `--cov-fail-under=82` in `ci-full-unit.yml`, web `coverageThreshold` in `jest.config.js`

**Not yet done:**
- Full end-to-end pipeline smoke test in CI
