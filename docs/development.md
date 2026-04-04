# Development Guide

## Project Structure

```
podlog/
├── docker-compose.yml              # 5 services: db, pipeline, worker, ollama, web
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
│   │   │   ├── api/                # FastAPI routers (feeds, episodes, queue, health, embed)
│   │   │   ├── tasks/              # Pipeline tasks (download, transcribe, diarize, embed, infer, archive)
│   │   │   └── services/           # Business logic (whisper, pyannote, alignment, embed)
│   │   ├── alembic/                # Database migrations
│   │   └── tests/                  # Unit, integration, e2e tests
│   └── web/                        # Next.js 14 (App Router)
│       ├── src/app/                # Pages: /, /podcasts, /episodes/[id], /queue, /feeds
│       ├── src/components/         # React components
│       └── src/lib/                # Utilities (db, search, timestamp, types)
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

### Unit Tests (383 tests — 302 pipeline + 81 web)

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

## Makefile Targets

```
make up                 Start all services
make down               Stop all services
make build              Rebuild all Docker images
make logs               Follow logs for all services
make migrate            Run database migrations
make test               Run all tests
make test-unit          Run unit tests only
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

## Codebase Audit

Automated comprehensive audit that checks architecture, documentation freshness, test coverage, dead code, wizard completeness, CLAUDE.md accuracy, and dependency health.

### On-demand (interactive)

From within a Claude Code session:

```
/codebase-audit
```

### Unattended (overnight)

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

### Nightly cron

```bash
# crontab -e
0 2 * * * cd /path/to/podlog && claude -p "/codebase-audit" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" --model opus --worktree --dangerously-skip-permissions --print > /tmp/audit-$(date +\%Y-\%m-\%d).log 2>&1
```

### Output

- **Report:** `docs/audit/YYYY-MM-DD-audit.md` — committed and pushed to main
- **Issues:** CRITICAL and WARNING findings auto-create GitHub issues with label `codebase-audit`
- **Status:** Check the `> Status:` line at the top of the report to see if it completed (`COMPLETE 7/7`) or was interrupted (`IN PROGRESS N/7`)

### What it checks

| Check | What it does |
|-------|-------------|
| Architecture | File structure, orphan files, circular deps, large files |
| Docs freshness | README claims, badge values, guide accuracy, PRD status |
| Test coverage | Runs pytest --cov and jest --coverage, parses results |
| Dead code | Files with no imports, orphaned tests, unused exports |
| Wizard completeness | Spec compliance + feature coverage gaps |
| CLAUDE.md accuracy | Repo structure, tech stack versions, current state |
| Dependency health | Outdated packages, unused deps, missing deps |
