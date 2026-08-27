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
| `prds/PRD-05-exploratory-plots.md` | Exploratory speaker plots in the Jupyter notebook (superseded in part by PRD-06) |
| `prds/PRD-06-speaker-analytics-plots.md` | Plotly speaker analytics on the Meta-Analysis web page |
| `prds/RISKS-AND-GAPS.md` | Active risks, known gaps, hardware requirements, resolved items |

When making decisions, reference PRD sections (e.g. "per PRD-01 §5.4") rather than re-deriving. The PRDs are the source of truth for requirements.

## Repo Structure

```
podlog/
├── docker-compose.yml              # Production-like local stack (7 services; explore is opt-in via profile)
├── docker-compose.remote.yml       # Overlay for remote-inference (Fireworks) profile
├── docker-compose.test.yml         # Test stack (db_test, mock_rss, pipeline_test, web_test, test runner)
├── .env.example                    # All config vars documented
├── Makefile                        # make up / down / build / test / etc.
├── AGENTS.md
├── README.md
├── CHANGELOG.md                    # Rendered at the bottom of /about; see Conventions
├── VERSION
├── LICENSE
├── .node-version                   # Node version for local dev
├── .nvmrc                          # Node version for nvm users
├── .github/                        # GitHub Actions workflows (ci, ci-full-unit, ci-slow, changelog, release, publish-images)
├── issues/                         # Local issue drafts / notes
├── backups/                        # Daily DB dumps + rsync audio snapshots (gitignored)
├── notebooks/                      # Jupyter exploration notebooks (gitignored bind mount)
├── apps/
│   ├── pipeline/                   # Python 3.11–3.13 — FastAPI + DB-backed job queue
│   │   ├── README.md               # Package guide (layout, running, tests)
│   │   ├── Dockerfile.control      # FastAPI control plane (poetry `--with embed`)
│   │   ├── Dockerfile.worker       # Worker image (poetry `--with ml,embed`)
│   │   ├── alembic.ini
│   │   ├── VERSION                 # Packaging metadata; runtime reads repo-root VERSION
│   │   ├── scripts/
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI app entry point
│   │   │   ├── config.py           # pydantic-settings, all env vars
│   │   │   ├── models.py           # SQLAlchemy ORM (feeds, episodes, segments, speaker_names)
│   │   │   ├── database.py         # Engine + session factory
│   │   │   ├── job_queue.py        # PostgreSQL-backed job queue (enqueue, claim, complete)
│   │   │   ├── task_registry.py    # Maps pipeline stages to task functions + next-stage routing
│   │   │   ├── worker.py           # Background job worker + feed polling loop
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health, ask, embed, backfill, notifications, hardware, meta_analysis, backups, explore, prompts)
│   │   │   ├── tasks/              # Pipeline tasks (ingest, download, transcribe, transcribe_helpers, diarize, chunk, embed, infer, archive, cleanup, prewarm, backfill_chunks, helpers)
│   │   │   └── services/           # Business logic (rss, whisper, pyannote, pyannote_cloud, alignment, chunking, embed, embed_provenance, speaker_turns, rag, inference, inference_helpers, inference_classify, inference_db, inference_ner, inference_types, meta_analysis, meta_analysis_aggregations, notifications, notification_events, notification_runtime, notification_settings, digest, digest_formatters, events, hardware, fireworks_audio, pipeline_commands, timing_labels, prompts, backup_files, backup_settings)
│   │   ├── alembic/                # Database migrations (22 versions)
│   │   └── tests/                  # unit, integration, e2e
│   ├── web/                        # Next.js 16 (App Router)
│   │   ├── Dockerfile              # Production image (standalone output)
│   │   ├── Dockerfile.test         # Test image used by docker-compose.test.yml
│   │   ├── src/app/                # Pages: /, /about, /podcasts, /podcasts/[id], /episodes/[id], /queue, /feeds, /ask, /search, /search/print, /settings, /docs, /meta-analysis (and /notifications redirects to /settings); DocsClient lives in app/docs/
│   │   ├── src/app/api/            # API routes: search (search, grouped, mentions, speakers), feeds (CRUD, [id], [id]/poll, [id]/episodes, [id]/episodes/guids, preview), queue, audio, ask/coverage, episodes ([id], [id]/retry, [id]/speakers, [id]/speakers/merge, ingest, upload), docs ([slug], ask), hardware, notifications (settings, test), pyannote/test, meta-analysis (snapshot, refresh, coverage/missing-speakers), pipeline (ask, embed, embed-model-state, explore/status, health, queue/[episodeId]/retry), backups ([tier]/[filename], audio/[date], retention), prompts ([key], [key]/reset), version
│   │   ├── src/components/         # Navbar, AudioPlayer, SearchResult, QueueStatus, etc.
│   │   ├── src/lib/                # db.ts, search.ts, search/ (allHandled, coverage, embedding, feedFilter, filters, filterOpts, grouped, grouping, mentions, queryParser, segments, types), searchHybrid.ts, timestamp.ts, pipeline.ts, types.ts, utils.ts, speakerColors.ts, validateMergeRequest.ts, citations.tsx, episode-link.ts, filename.ts, dateFormat.ts, docs-index.ts, docs-retrieval.ts, docs-search.ts, docs-slug.ts, formatFileSize.ts, settings-schema.ts, metaAnalysisStale.ts, metaAnalysisTypes.ts, normalizeName.ts, page-state.ts, queueStatus.ts, rag-models.ts, semver.ts, keyboardShortcuts.ts, useKeyboardShortcut.ts, useChordShortcut.ts
│   │   └── src/types/              # Ambient module shims (plotly-cartesian.d.ts, #746)
│   ├── backup/                     # Nightly backup service (Dockerfile + backup.sh + restore scripts)
│   └── explore/                    # Jupyter DB-exploration container (Dockerfile + requirements.txt; opt-in via `make explore`)
├── docs/                           # User-facing documentation and guides
├── scripts/                        # Operational scripts (health check, docs-sync + npm/node CI gates, release-notes extractor, workflow-injection check)
└── prds/                           # Specifications and risk register
```

Agent-tool metadata (`.agents/`, `.superpowers/`, `.omx/`, `.claude/`, `.worktrees/`) lives at the repo root but is gitignored — present locally, not part of the project tree.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Pipeline API | FastAPI (Python 3.11–3.13) | Internal API consumed by web app |
| Task queue | PostgreSQL-backed job queue | Sequential processing (concurrency=1) to avoid OOM |
| Transcription | WhisperX (CTranslate2 backend), default `large-v3-turbo` | Explicit unload before diarization — mandatory |
| Diarization | `pyannote/speaker-diarization-community-1` local (override via `PYANNOTE_MODEL`) or pyannote.ai cloud `precision-2` (`DIARIZATION_PROVIDER=precision2`, Issue #516) | Requires HF_TOKEN for local or `PYANNOTE_API_KEY` for cloud; graceful failure path |
| LLM inference | Ollama (local) or Fireworks AI (remote) | RAG-based Ask AI feature; provider selected via `inference_provider` config; model selected in Ask UI per request |
| Database | PostgreSQL 15 (pgvector/pgvector:pg15) | FTS via `to_tsvector` + GIN index, vector HNSW index |
| ORM | SQLAlchemy 2.0 + Alembic | Migrations auto-run on pipeline startup |
| Web app | Next.js 16 (App Router) | `output: 'standalone'` for Docker |
| Styling | Tailwind CSS + shadcn/ui | Tailwind 4 — CSS-first config, so there is **no** `tailwind.config.*`; the dark-mode `class` strategy lives as `@custom-variant dark` in `src/app/globals.css`. shadcn/ui component set is installed |
| Data fetching | TanStack React Query + fetch/setInterval | React Query for search/coverage data; queue status uses `fetch` polling in `QueueStatus.tsx` |
| DB client (web) | `pg` (node-postgres) raw SQL | Direct PostgreSQL queries for search |

## Key Architectural Decisions

- **Whisper and pyannote never in memory simultaneously.** Whisper is explicitly unloaded (+ `gc.collect()`) before pyannote loads. This is mandatory on CPU-only machines. See PRD-01 §5.4.
- **Web app reads DB directly for search** but proxies to the pipeline API for feed management, queue retries, and health checks.
- **Audio serving has path traversal protection.** The `/api/audio/[episodeId]/[filename]` route strips path separators and validates the resolved path stays within allowed audio directories (`/data/audio/archive/` and `/data/audio/raw/`).
- **Error classification drives retry logic.** Auto-retry is decided by the `transient` flag from `worker.py::_classify_for_retry`, not by the class name: `TRANSIENT_NETWORK` retries (up to 3x with exponential backoff); `DISK_FULL`, `OOM` and `SYSTEM_ERROR` fail immediately. `HTTP_ACCESS` is terminal from the generic classifier (a 4xx on a podcast audio URL will not resolve on retry) but retryable when raised by the Fireworks or pyannote-cloud services, whose typed errors set `retryable=True` and win at step 1.
- **Diarization failure is non-fatal.** If pyannote fails, the transcript is still written with `speaker_label = NULL` and `has_diarization = false`.

## How to Run

```bash
cp .env.example .env   # Edit: set POSTGRES_PASSWORD and HF_TOKEN
make build             # Build Docker images
make up                # Start the stack (6 services; explore is opt-in, see `make explore`)
make logs              # Follow logs
make test-unit         # Run pipeline unit tests + host healthcheck test (no web unit tests)
make ci-local          # Run every blocking CI check locally, using CI's own commands
make shell-db          # Open psql shell
```

`make up` starts db, pipeline, worker, ollama, web, and backup (6 services); `explore` is opt-in via the `explore` compose profile (`make explore`). Exposed ports: web on `0.0.0.0:3000` (reachable from the LAN, deliberately); db (:5432), pipeline API (:8000) and ollama (:11434) are bound to `127.0.0.1` only (#952), as `explore` (:8888) already was. Host tooling keeps working — `scripts/healthcheck.py`, `make backfill` and the guides all use `localhost` — and containers reach each other by service name over the compose network, not through these mappings.

## Conventions

- **Python style:** Ruff for linting, 100 char line length, type hints everywhere, structured JSON logging to stdout.
- **TypeScript style:** ESLint + Next.js config, `@/*` path alias for imports, strict mode.
- **Naming:** Display name is "Podlog". Database name is `podlog`. Docker services use short names (db, pipeline, worker, ollama, web).
- **Testing:**
  - Pipeline: `pytest` — unit tests mock DB/models, integration tests use a real test DB.
  - Web: `jest` + `@testing-library/react` for unit, `playwright` for e2e.
- **PRD references:** When implementing a feature, cite the PRD section (e.g. "per PRD-02 §5.6") in code comments only where the requirement is non-obvious.
- **Security model (#960, #988):** Podlog assumes a single trusted host **on a trusted network**. The pipeline API has **no authentication** — every write endpoint (settings, which holds the Fireworks/pyannote keys; feed CRUD; upload; retry; backfill; backup deletion) is open to anything that can reach port 8000. Binding db/pipeline/ollama to `127.0.0.1` (#952) protects port 8000 *directly*, but **the web app is an unauthenticated write proxy to it** — there is no `middleware.ts` and no auth check anywhere in `apps/web`, and 23 mutating routes under `apps/web/src/app/api/` forward straight through. So the effective trust boundary is the **LAN**, not the host: anyone who can reach `:3000` can delete feeds, episodes and backups. Do not describe LAN exposure as read-only browsing. Two changes break what boundary remains and require adding auth first: re-publishing db/pipeline/ollama to `0.0.0.0`, or moving the `web` container to a different host. Documented in `docs/guide/01-installation.md`; options weighed in #960.
- **Per-change obligations (#991):** Three things are expected of every PR. They live together here because they are one habit, not three.

  1. **CHANGELOG.** A one-line entry under `## Unreleased` for user-visible behaviour, grouped Major / Minor / Fixes / Internal. Enforced by `.github/workflows/changelog.yml`; the escape hatch is the `no-changelog` label.
  2. **Docs accuracy.** Before opening the PR, work out which docs describe the behaviour you changed and update them in the same PR — or state explicitly in the PR body that you checked and none apply. Saying "checked, none apply" is most of the value: it is the difference between deciding and forgetting. Use the map below. This is **not** CI-enforced on purpose — a gate that cannot judge correctness degrades into touching any docs file to go green, which manufactures assurance rather than providing it. `scripts/check_docs_sync.py` only verifies that paths named in the docs exist; it cannot tell that a documented default changed.
  3. **Design docs.** If the change alters the design, update the relevant PRD and `prds/RISKS-AND-GAPS.md` (this is the pre-existing rule, folded in here so all three obligations are in one place).

  **Which doc covers what.** The step most likely to be skipped is "which doc describes this?", so it is written down. Not exhaustive — when in doubt, grep `docs/guide/` for the feature name.

  | If you changed… | Check |
  |---|---|
  | `apps/pipeline/app/config.py`, `.env.example` | `docs/configuration.md`, `docs/guide/10-configuration.md` |
  | `docker-compose.yml` ports, `Makefile` startup, `scripts/print-access.sh` | `docs/guide/01-installation.md` (incl. the Security model section) |
  | `apps/pipeline/app/tasks/ingest.py`, feeds API/UI | `docs/guide/03-feeds.md` |
  | `apps/web/src/lib/search.ts`, search routes | `docs/guide/04-search.md` |
  | Episode page, transcript rendering | `docs/guide/05-episodes.md` |
  | `apps/pipeline/app/services/inference.py`, `tasks/infer.py`, speaker UI | `docs/guide/06-speakers.md` |
  | `apps/web/src/components/AudioPlayer.tsx` | `docs/guide/07-audio-playback.md` |
  | `apps/pipeline/app/api/queue.py`, `apps/web/src/lib/queueStatus.ts` | `docs/guide/08-queue.md` |
  | Notification settings, digest, healthcheck | `docs/guide/09-notifications.md` |
  | Timings, image sizes, storage figures | `docs/guide/11-hardware.md`, `docs/hardware.md` |
  | `apps/pipeline/app/services/rag.py`, `apps/web/src/lib/rag-models.ts` | `docs/guide/12-rag-search.md` |
  | `apps/pipeline/app/services/pyannote_cloud.py`, diarization providers | `docs/guide/13-pyannote-cloud.md`, `docs/guide/19-inference-providers.md` |
  | `apps/web/src/app/meta-analysis` | `docs/guide/14-meta-analysis.md` |
  | `apps/explore`, notebooks | `docs/guide/15-explore.md` |
  | `apps/backup`, `apps/pipeline/app/services/backup_files.py` | `docs/guide/16-backups.md` |
  | `apps/web/src/lib/keyboardShortcuts.ts` | `docs/guide/18-keyboard-shortcuts.md` |

  This table is itself checked: `check_docs_sync.py` scans `CLAUDE.md` for path mentions and fails CI if any stops existing.

- **Versioning (#936):** `/VERSION` at the repo root is the **only file containing a version**. The git tag is the only other place a version appears, and `scripts/release_notes.py` asserts the two agree before a release publishes. `apps/pipeline/pyproject.toml` and `apps/web/package.json` are both pinned to the `0.0.0` sentinel on purpose — neither is read at runtime, and keeping them "in sync by hand" is exactly how `package.json` drifted five minor versions behind without anything noticing. Do not reintroduce a version number anywhere else.
- **Semver policy:** **Major** — a change the operator must act on: a removed or renamed env var, a migration that cannot be rolled back by restoring the previous dump, a new external service requirement (e.g. a newly mandatory API key), or a breaking change to the pipeline API the web app consumes. **Minor** — new user-visible capability, additive env vars with working defaults, additive migrations. **Patch** — fixes, dependency refreshes, docs, internal work.
- **Releasing:** bump `/VERSION`, graduate `## Unreleased` into a dated section, merge, then push a `vX.Y.Z` annotated tag. `.github/workflows/release.yml` validates and publishes. It refuses to publish if the tag disagrees with `VERSION`, or if `## Unreleased` still holds entries. No fixed calendar — cut a release when `Unreleased` has accumulated user-visible entries and CI is green.
- **When modifying the design:** Update the relevant PRD and RISKS-AND-GAPS.md. Bump the version number.
- **Changelog:** PRs that ship user-visible behavior add a one-line entry to `CHANGELOG.md` under `## Unreleased`, grouped as Major / Minor / Fixes (or Internal where appropriate). Version headings are bare semver (`## 0.3.0 — 2026-04-24`), not the keepachangelog reference-link form (`## [0.3.0]`) — the latter breaks the About-page anchor lookup (#644). The same file is rendered at the bottom of `/about` in the web app, so write entries for a human reading them there.

## Operational Gotchas

Lessons from active development. Short rules; rationale linked to the incident or PRD section that proved them.

- **Test images bake test files at build time.** Both `apps/pipeline/Dockerfile.worker` (used by `test`) and `apps/web/Dockerfile.test` do `COPY . .`, so editing a test file and re-running `docker compose -f docker-compose.test.yml run --rm test/web_test` executes the OLD copy. Rebuild the test image (`docker compose -f docker-compose.test.yml build test web_test`) after any test edit. Symptom: test count stays the same after adding cases.

- **A Tailwind class naming an undefined token renders as nothing, not as an error.** `bg-popover` with no `--color-popover` in the `@theme` block of `globals.css` produces no fill at all — the element paints only its border and text. This shipped twice: #423 reported a see-through Export dropdown, #428 fixed it by swapping to `bg-background`, and #848 reintroduced it by re-copying `dropdown-menu.tsx` from upstream shadcn, which uses the upstream token names. Define the token rather than swapping the class, or the next upstream re-copy breaks it again. `scripts/check_ui_tokens.py` (wired into CI Fast and `make ci-local`) now fails the build on any `bg-*` / `text-*` / `ring-*` in `components/ui/` naming a token absent from `@theme`.

- **Never pass `--remove-orphans` to `docker-compose.test.yml`.** Neither compose file sets a `name:`, so both derive the same project name (`podlog`) from the directory, while their service names are disjoint (`db_test` / `mock_rss` / `test` / `pipeline_test` / `web_test` vs `db` / `pipeline` / `worker` / `ollama` / `web` / `backup`). From the test file's point of view **every production service is an orphan**, so `docker compose -f docker-compose.test.yml down --remove-orphans` tears down the live stack — including a worker mid-job. Plain `down` is the same trap for the same reason. Clean up test containers by explicit service name instead:

```bash
docker compose -f docker-compose.test.yml rm -sf db_test mock_rss pipeline_test web_test test
```

Data volumes survive (`-v` only drops volumes declared in the file it was given), but in-flight jobs do not — one was killed this way and came back as `SYSTEM_ERROR` via the zombie sweep.

- **Use `gen_random_uuid()` without `::text` cast in raw SQL.** All `id` / `feed_id` / `last_seen_episode_id` columns are PostgreSQL `uuid` (declared via `sa.dialects.postgresql.UUID(as_uuid=False)`). Casting to text and inserting into a uuid column raises `DatatypeMismatch` and halts pipeline boot at `alembic upgrade head`. Match the pattern from `001_initial_schema.py`: `server_default = sa.text("gen_random_uuid()")`. This bit us in migration 014 — caught only on first prod restart, not in unit tests.

- **Worker is non-interruptible; verify queue is drained before restart.** `concurrency=1` and in-flight jobs can take minutes. Before `docker compose up -d worker`, run `docker compose exec -T db psql -U postgres podlog -c "SELECT task, status, COUNT(*) FROM job_queue WHERE status IN ('pending','running') GROUP BY task, status;"` and confirm 0 rows. For idle periods this is fast; otherwise wait or use `docker compose stop -t 60 worker` for graceful shutdown.

- **Smoke-test migrations against a real DB before merging.** Unit tests mock the DB so SQL type errors (like the UUID cast above) pass tests and only surface when `alembic upgrade head` runs on a real PostgreSQL in `docker compose up`. Before merging a migration PR, at minimum do `docker compose build pipeline && docker compose up -d pipeline` and check the logs, or run the migration against `db_test` via the test stack.

- **When a dependency's shape changes, rewrite its mocks — don't just update the tests.** The `episodes-speakers-route` test mocked `pool.query` directly. When the route switched to `pool.connect()` for a transaction, the mock shape no longer matched the code, and the tests' "pass" was meaningless. Follow the `speaker-merge-route.test.ts` pattern: mock `pool.connect()` returning a fake client with `query`/`release`, assert `BEGIN`/`COMMIT`/`ROLLBACK` ordering explicitly.

- **Cross-runtime helpers (TS + Python) must stay in lockstep.** When a normalization / canonicalization rule is duplicated across `apps/pipeline/` and `apps/web/`, give each copy a test suite that enumerates the same cases, and cross-reference the files in comments. `apps/web/src/lib/normalizeName.ts` ↔ `apps/pipeline/app/services/inference_helpers.py::normalize_name` is the pattern. Silent divergence corrupts shared DB keys (e.g. `normalized_name` cache column).

- **Self-reinforcement analysis is a design concern for any feature that queries its own prior output.** Two patterns we've used (PRD-04): (a) emit at MEDIUM confidence so the rule's output rows can't satisfy the HIGH filter on the next cycle (`recurring_host`); (b) sever the data source so inference never writes to the table the heuristic reads (`feed_speaker_cache` is populated only from user renames). The `METADATA_SOURCES` frozenset is the mechanism that lets pre-classified candidates bypass heuristic reclassification.

- **Keep torch on the CPU wheel index, and keep the control plane off the `ml` group.** Both images install torch from the explicit `pytorch-cpu` source declared in `apps/pipeline/pyproject.toml`; the default PyPI wheel bundles 4.2 GB of CUDA runtime that no container can use, because nothing in `docker-compose.yml` grants a GPU (#977). Two traps if you touch this: (a) **anything linking against torch must come from the same index** — a PyPI `torchvision` paired with `torch+cpu` resolves fine and then dies at import with *"partially initialized module 'torchvision' has no attribute 'extension'"*, which is why it is pinned explicitly despite being transitive; (b) `Dockerfile.control` installs `--with embed`, not `--with ml` — the control plane never runs a pipeline stage, and `sentence-transformers` is the only heavy thing any endpoint reaches. Verify with `docker run --rm --entrypoint python podlog-pipeline:latest -c "import sys, app.main; print('whisperx' in sys.modules)"` — everything heavy is lazily imported and should report False. `triton` (540 MB) stays in the worker: it is a direct dependency of whisperx, not of torch.

- **Split large issues into sequential PRs, not one bundle.** Issue #523 was shipped as 5 PRs (#525, #526, #527, #529, #531 + hotfix #532). Each PR had its own review / merge / prod-smoke loop. The hotfix pattern (#532 as a 2-line follow-up to #531) is cheaper than reverting or force-pushing over a merged PR.

- **ESLint 9 → 10 is blocked upstream — verify readiness before re-attempting.** Codebase audits keep surfacing this as a major-version bump available (#494, #551, #676 are all the same finding). The block is in `eslint-config-next`'s bundled `eslint-plugin-react@7.37.5`, which uses the `context.getFilename()` method removed in ESLint 10 and crashes on every file with `TypeError: contextOrFilename.getFilename is not a function`. Before opening a new bump issue, check the resolved plugin version:

```bash
# Run from the repo root. npm hoists the plugin — there is normally NO
# nested copy under eslint-config-next/node_modules (it holds only globals/).
node -p "require('./apps/web/node_modules/eslint-plugin-react/package.json').version"
# and confirm what eslint-config-next asks for
node -p "require('./apps/web/node_modules/eslint-config-next/package.json').dependencies['eslint-plugin-react']"
```

If the resolved version is still ≤ 7.37.x, the block stands and the audit finding should be treated as a known-blocked duplicate of #494. When it is ≥ 7.38, attempt the bump fresh. (Remove this note once the bump lands.) As of 2026-08-08: resolved `7.37.5`, declared `^7.37.0` by `eslint-config-next@16.2.6` — still blocked.

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
- Full end-to-end pipeline smoke test in CI. The test exists (`apps/pipeline/tests/e2e/test_full_flow.py`, `@pytest.mark.e2e`, spins up the full Docker stack and exercises ingest→archive), but no CI job runs it: `ci-slow.yml` runs only pipeline `tests/integration/` and the web Playwright suite. Wiring the `tests/e2e/` full-flow test into CI is the remaining work.
