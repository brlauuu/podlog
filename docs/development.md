# Development Guide

## Project Structure

```
podlog/
├── docker-compose.yml              # default profile: db, pipeline, worker, ollama, web
├── docker-compose.remote.yml       # remote-inference override (no ollama)
├── .env.example                    # All config vars documented
├── Makefile                        # make up / down / build / test / etc.
├── apps/
│   ├── pipeline/                   # Python 3.11 — FastAPI + Worker
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI app (control plane)
│   │   │   ├── worker.py           # Job queue worker (processing plane)
│   │   │   ├── config.py           # pydantic-settings, all env vars
│   │   │   ├── models.py           # SQLAlchemy ORM (feeds, episodes, segments)
│   │   │   ├── database.py         # Engine + session factory
│   │   │   ├── job_queue.py        # DB-backed job queue (FOR UPDATE SKIP LOCKED)
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health, ask, embed, backfill, notifications)
│   │   │   ├── tasks/              # Pipeline tasks (ingest, download, transcribe, diarize, chunk, embed, infer, archive, cleanup, prewarm)
│   │   │   └── services/           # Business logic (rss, whisper, pyannote, alignment, chunking, embed, rag, inference, notifications, digest, events)
│   │   ├── alembic/                # Database migrations
│   │   └── tests/                  # Unit, integration, e2e tests
│   └── web/                        # Next.js 16.2.2 (App Router)
│       ├── src/app/                # Pages: /, /podcasts, /episodes/[id], /queue, /feeds, /ask, /settings (/notifications redirects here)
│       ├── src/components/         # React components
│       └── src/lib/                # Utilities (db, search, timestamp, pipeline, types, utils, speakerColors, validateMergeRequest)
├── docs/                           # User-facing documentation
└── prds/                           # Internal design specs and risk register
```

## Local Development

### Prerequisites

- Python 3.11+ with [Poetry](https://python-poetry.org/)
- Node.js 20+ with npm
- Docker and Docker Compose (for the database)

### Pipeline (Python)

```bash
cd apps/pipeline

# Install dependencies
poetry install --with ml --with dev

# Run unit tests (fast, no Docker needed)
python -m pytest tests/unit/ -v

# Run with coverage
python -m pytest tests/unit/ --cov=app --cov-report=term-missing

# Lint
poetry run ruff check .
poetry run ruff format --check .
```

### Web (Next.js)

```bash
cd apps/web

# Install dependencies
npm install

# Development server
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Unit tests (files exercised by current tests)
npm test -- --runInBand

# Coverage (full app denominator under src/** via jest collectCoverageFrom)
npm test -- --coverage --runInBand
```

### Database

The easiest way to get a local database is via Docker:

```bash
# Start just the database
docker compose up -d db

# Open psql shell
make shell-db

# Run migrations
docker compose exec pipeline alembic upgrade head
```

## Running Tests

### Unit Tests

```bash
cd apps/pipeline
python -m pytest tests/unit/ -v
```

These test pure business logic (alignment, search, cleanup, inference, RSS parsing) with mocked dependencies. No Docker, no database, no ML models needed.

### Integration Tests

```bash
make test-integration
```

Require a running database and `HF_TOKEN` for pyannote model access.

### End-to-End Tests

```bash
make test-e2e
```

Run Playwright browser tests against the full Docker stack.

For local Playwright runs (outside Docker), install browsers once and run:

```bash
cd apps/web
npm run test:e2e:install
npm run test:e2e
```

### GitHub Actions CI

The repository uses three CI lanes:

- Fast lane ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml))
  - Trigger: push to `main` and pull requests
  - `pipeline-unit-fast`: stable subset
  - `web-unit-fast`: stable subset
- Full unit lane ([`.github/workflows/ci-full-unit.yml`](../.github/workflows/ci-full-unit.yml))
  - Trigger: push to `main` and pull requests
  - `pipeline-unit-full`: all pipeline unit tests
  - `web-unit-full`: all web unit tests
- Slow lane ([`.github/workflows/ci-slow.yml`](../.github/workflows/ci-slow.yml))
  - Trigger: nightly schedule and manual dispatch
  - `pipeline-integration`: integration tests in Docker
  - `web-e2e`: Playwright e2e tests in Docker

The README shows live status badges for each lane.

## Makefile Targets

```
make up                 Start all services
make down               Stop all services
make build              Rebuild all Docker images
make logs               Follow logs for all services
make migrate            Run database migrations
make test               Run all tests
make test-unit          Run pipeline unit tests + host healthcheck tests (no web unit tests)
make test-integration   Run integration tests
make test-e2e           Run Playwright e2e tests
make shell-db           Open psql shell
make shell-pipeline     Open pipeline container shell
make shell-web          Open web container shell
make health-check       Run health check once
make health-install     Install health check cron job (every 15 min)
make health-uninstall   Remove health check cron job
make help               List all available commands
```

## Key Architectural Decisions

1. **Whisper and pyannote never in memory simultaneously.** The worker explicitly unloads Whisper (`gc.collect()`) before loading pyannote. This is mandatory for CPU-only machines where combined memory would exceed available RAM.

2. **PostgreSQL-backed job queue.** Replaced Celery/Redis with `FOR UPDATE SKIP LOCKED` polling on a `job_queue` table. One fewer container, simpler ops, and the database is already there.

3. **Sequential processing (concurrency=1).** ML models are memory-intensive. Running two transcriptions or diarizations in parallel would OOM on most machines. The worker processes one job at a time.

4. **Web app reads DB directly for search.** The Next.js web app connects directly to PostgreSQL for search queries (FTS + pgvector), avoiding a round-trip through the pipeline API. Feed management and queue control still proxy through the pipeline API.

5. **Speaker turn aggregation in search.** Search results are deduplicated by speaker turn using window functions, so a speaker's complete thought appears as one result instead of fragmented per-sentence hits.

6. **Hybrid search with RRF.** Full-text search and vector similarity run in parallel, results are merged using Reciprocal Rank Fusion. Falls back gracefully to FTS-only when no embeddings are available.

## Conventions

- **Python:** Ruff linting, 100 char line length, type hints, structured JSON logging
- **TypeScript:** ESLint + Next.js config, `@/*` path alias, strict mode
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `perf:`)
- **PRs:** Squash merge to main, branch names follow `{issue}-{description}` pattern
- **Testing:** Unit tests mock DB/models, integration tests use real DB, e2e tests use Playwright

## Audit Workflows

Podlog currently uses two distinct audit paths:

1. Codex audit workflow (`nightly-audit` skill)
2. Claude audit workflow (`/codebase-audit`)

Both workflows target the same core quality concerns: correctness bugs, regressions, stale docs, dead code, test gaps, and dependency health.

### Codex Audit Workflow

The Codex path is driven by the repo-local `nightly-audit` skill:

- Skill location: `.agents/skills/nightly-audit/SKILL.md`
- Repo policy source: `AGENTS.md`
- Typical use: unattended or broad whole-repo review from a Codex session

#### How to run (Codex)

In a Codex session, explicitly request the skill, for example:

```
Use $nightly-audit and run a full repository audit.
```

Or section mode:

```
Use $nightly-audit. Audit focus: Dependency Health. Output only that section.
```

#### Output format (Codex)

The `nightly-audit` skill defines structured outputs:

- Full-report mode:
  - `# Codebase Audit — YYYY-MM-DD`
  - `## Summary`
  - `## Architecture Review`
  - `## Docs Freshness`
  - `## Test Coverage`
  - `## Dead Code Detection`
  - `## Wizard Completeness`
  - `## CLAUDE.md Accuracy`
  - `## Dependency Health`
  - `## Suggested Next Steps`
- Section mode: exactly one requested section
- Findings format:
  - `- **[SEVERITY]** One-line description`
  - `  - File: path/to/file.ext:line`
  - `  - Evidence: what was checked and what was found`

Allowed severities are `CRITICAL`, `WARNING`, and `INFO`.

#### Safety constraints (Codex unattended audits)

Per `AGENTS.md` and the `nightly-audit` skill:

- Do not modify source files.
- Do not commit or push.
- Do not create GitHub issues unless explicitly requested.
- Include concrete file-path evidence for findings.

Codex audit results are typically report/chat output unless a caller explicitly requests writing a report file.

### Claude Audit Workflow

The Claude path uses `/codebase-audit`, documented and runnable via Claude CLI.

#### On-demand (interactive)

From within a Claude Code session:

```
/codebase-audit
```

#### Unattended (overnight)

```bash
claude -p "/codebase-audit" \
  --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" \
  --model opus \
  --worktree \
  --dangerously-skip-permissions \
  --print \
  > /tmp/audit-$(date +%Y-%m-%d).log 2>&1
```

**Flags explained:**
- `--allowedTools` — Read/Glob/Grep for analysis, Bash for running tests and git/gh, Write/Edit for the report, Agent for parallel subagents
- `--model opus` — uses Opus for highest quality analysis
- `--worktree` — runs in an isolated git worktree (safe, won't touch your working directory)
- `--dangerously-skip-permissions` — required for unattended runs (no interactive prompts)
- `--print` — non-interactive mode, exits when done

#### Nightly cron

```bash
# crontab -e
0 2 * * * cd /path/to/podlog && claude -p "/codebase-audit" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" --model opus --worktree --dangerously-skip-permissions --print > /tmp/audit-$(date +\%Y-\%m-\%d).log 2>&1
```

#### Output (Claude)

- Reports are written to `docs/audit/YYYY-MM-DD/claude/` (one file per check plus `summary.md`)
- No auto-commit or issue creation; reports are left for manual review
- Completion state is visible in `summary.md` (`COMPLETE 7/7` or `IN PROGRESS N/7`)

### Codex vs Claude: Intended Difference

| Topic | Codex (`nightly-audit`) | Claude (`/codebase-audit`) |
|-------|--------------------------|----------------------------|
| Primary entrypoint | Skill invoked in Codex chat/session | Slash workflow in Claude session/CLI |
| Typical use | Unattended or broad read-heavy audits with strict evidence formatting | Interactive or scheduled sectioned reports written to `docs/audit/` |
| Output shape | Structured finding blocks in full-report or section mode | Section files + `summary.md` artifact set |
| Artifact default | Usually chat/report output unless explicitly asked to write files | Explicit local files under `docs/audit/` |
| Auto issue creation | Not allowed unless explicitly requested | Not automatic; manual review artifact flow |
| Commit/push behavior | Not allowed in unattended mode unless explicitly requested | Not part of normal audit flow |

### Safety Expectations (Both Paths)

- Prefer isolated worktrees for unattended runs.
- Audits should be non-destructive and analysis-first.
- No commit/push as part of a standard audit run.
- No automatic issue creation unless explicitly requested.

### Findings Lifecycle (How Audits Improve the Repo)

In this project, audit output is used as an input to normal issue/PR development:

1. Run an audit (Codex or Claude path).
2. Review findings and create or update focused GitHub issues (often labeled `codebase-audit`).
3. Implement fixes in regular branches/PRs with tests and validation.
4. Merge fixes and close the related audit issues.

This keeps audits visible to contributors while preserving normal review and merge controls.
