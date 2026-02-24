# PRD-03: Project Infrastructure, Repository Structure & Docker Setup

**Project:** PodSearch — Self-hosted Podcast Transcription & Search  
**Document:** PRD-03 — Infrastructure & DevOps  
**Version:** 1.1  
**Status:** Draft  
**Author:** Claude (generated from user specification)  
**Changelog:** v1.1 — Pipeline service healthcheck added; `web` dependency changed from `service_started` to `service_healthy` to close migration race condition; `docker-compose.yml` updated to reflect new `error_class`, `retry_count`, `diarization_error` schema fields; model pre-warm documented in worker startup.

---

## 1. Purpose

This document covers everything that spans PRD-01 and PRD-02: the monorepo layout, Docker Compose configuration, CI/CD, environment management, and contributor setup. It is the "glue" document that lets a developer clone the repo and have a running system in one command.

---

## 2. Repository Structure

```
podsearch/
├── docker-compose.yml
├── docker-compose.test.yml
├── docker-compose.override.yml     # gitignored
├── .env.example
├── .env                            # gitignored
├── Makefile
├── README.md
├── LICENSE                         # MIT
│
├── apps/
│   ├── pipeline/
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   ├── alembic/
│   │   │   ├── env.py
│   │   │   └── versions/
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   ├── models.py           # Includes error_class, retry_count, diarization_error
│   │   │   ├── api/
│   │   │   │   ├── feeds.py
│   │   │   │   ├── episodes.py
│   │   │   │   ├── queue.py
│   │   │   │   └── health.py       # Returns WARMING_UP | OK
│   │   │   ├── tasks/
│   │   │   │   ├── celery_app.py
│   │   │   │   ├── ingest.py
│   │   │   │   ├── download.py     # Auto-retry logic with error classification
│   │   │   │   ├── transcribe.py   # Explicit model unload after transcription
│   │   │   │   ├── diarize.py      # Graceful failure path
│   │   │   │   ├── archive.py      # Disk-full handling
│   │   │   │   └── prewarm.py      # Model pre-warm on worker startup
│   │   │   ├── services/
│   │   │   │   ├── rss.py
│   │   │   │   ├── whisper.py
│   │   │   │   ├── pyannote.py
│   │   │   │   └── alignment.py    # Majority-overlap timestamp merging
│   │   │   └── scheduler.py
│   │   └── tests/
│   │       ├── fixtures/
│   │       │   └── sample.mp3
│   │       ├── unit/
│   │       │   ├── test_rss.py
│   │       │   ├── test_alignment.py
│   │       │   ├── test_retry.py   # Error classification and retry logic
│   │       │   └── test_api.py
│   │       ├── integration/
│   │       │   └── test_pipeline.py
│   │       └── e2e/
│   │           └── test_full_flow.py
│   │
│   └── web/
│       ├── Dockerfile
│       ├── package.json
│       ├── next.config.ts
│       ├── tailwind.config.ts      # dark mode: 'class' strategy
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx      # Root layout with AudioPlayerContext + global player
│       │   │   ├── page.tsx
│       │   │   ├── podcasts/
│       │   │   ├── episodes/[id]/
│       │   │   ├── queue/
│       │   │   └── api/
│       │   │       ├── search/
│       │   │       ├── feeds/
│       │   │       ├── queue/
│       │   │       └── audio/
│       │   │           └── [episodeId]/
│       │   │               └── [filename]/
│       │   │                   └── route.ts  # Path-validated audio serving
│       │   ├── components/
│       │   │   ├── ui/
│       │   │   ├── SearchBar.tsx
│       │   │   ├── SearchResult.tsx        # Includes diarization warning badge
│       │   │   ├── AudioPlayer.tsx         # Global persistent player bar
│       │   │   ├── AudioPlayerContext.tsx  # React context for player state
│       │   │   ├── DarkModeToggle.tsx
│       │   │   ├── QueueStatus.tsx         # Includes retry countdown, warm-up banner
│       │   │   └── SpeakerLabel.tsx
│       │   └── lib/
│       │       ├── db.ts
│       │       ├── search.ts
│       │       └── timestamp.ts            # Path-safe URL builder
│       └── tests/
│           ├── unit/
│           └── e2e/
```

---

## 3. Docker Compose

### 3.1 Production-like Local Stack (`docker-compose.yml`)

```yaml
version: "3.9"

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: podsearch
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

  pipeline:
    build: ./apps/pipeline
    command: >
      sh -c "alembic upgrade head &&
             uvicorn app.main:app --host 0.0.0.0 --port 8000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podsearch
      REDIS_URL: redis://redis:6379/0
    ports:
      - "8000:8000"
    volumes:
      - audio_data:/data/audio
      - transcript_data:/data/transcripts
      - model_cache:/root/.cache/huggingface
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      # Health endpoint returns 200 only after migrations complete and app is ready
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  worker:
    build: ./apps/pipeline
    # Pre-warm runs before the worker starts accepting jobs
    command: >
      sh -c "python -m app.tasks.prewarm &&
             celery -A app.tasks.celery_app worker --loglevel=info --concurrency=1"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podsearch
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
        condition: service_healthy   # Ensures migrations are done before worker starts

  beat:
    build: ./apps/pipeline
    command: celery -A app.tasks.celery_app beat --loglevel=info
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podsearch
      REDIS_URL: redis://redis:6379/0
    depends_on:
      - worker

  flower:
    build: ./apps/pipeline
    command: celery -A app.tasks.celery_app flower --port=5555
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379/0
    ports:
      - "5555:5555"
    depends_on:
      - redis

  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podsearch
      PIPELINE_API_URL: http://pipeline:8000
    volumes:
      - audio_data:/data/audio:ro
    depends_on:
      db:
        condition: service_healthy
      pipeline:
        condition: service_healthy   # Waits for migrations — prevents schema-not-found errors

volumes:
  postgres_data:
  redis_data:
  audio_data:
  transcript_data:
  model_cache:
```

**Key changes from v1.0:**
- `pipeline` now has a `healthcheck` that only passes after the app is ready (post-migration).
- `web` depends on `pipeline` with `service_healthy` (was `service_started`). This closes the race condition where the web app could start before Alembic migrations completed.
- `worker` depends on `pipeline` with `service_healthy`, ensuring the schema exists before the worker tries to write to the database.
- `worker` command runs `prewarm.py` before starting Celery, downloading model weights on first run.
- Migration (`alembic upgrade head`) runs in the `pipeline` startup command, before the FastAPI server starts.

### 3.2 Dev Overrides (`docker-compose.override.yml` — gitignored)

```yaml
services:
  pipeline:
    volumes:
      - ./apps/pipeline:/app
    command: >
      sh -c "alembic upgrade head &&
             uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

  web:
    volumes:
      - ./apps/web:/app
      - /app/node_modules
    command: npm run dev
```

### 3.3 Test Stack (`docker-compose.test.yml`)

```yaml
services:
  db_test:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: podsearch_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: test
    tmpfs:
      - /var/lib/postgresql/data

  mock_rss:
    image: nginx:alpine
    volumes:
      - ./apps/pipeline/tests/fixtures:/usr/share/nginx/html:ro

  test:
    build: ./apps/pipeline
    command: pytest tests/ -v --cov=app --cov-report=term-missing
    environment:
      DATABASE_URL: postgresql://postgres:test@db_test:5432/podsearch_test
      REDIS_URL: redis://redis_test:6379/0
      MOCK_RSS_URL: http://mock_rss/feed.xml
      HF_TOKEN: ${HF_TOKEN}
    depends_on:
      - db_test
      - mock_rss

  web_test:
    build: ./apps/web
    command: npx playwright test
    environment:
      DATABASE_URL: postgresql://postgres:test@db_test:5432/podsearch_test
    depends_on:
      - db_test
```

---

## 4. Environment Variables

### `.env.example`

```env
# ── Required ──────────────────────────────────────────────
POSTGRES_PASSWORD=changeme
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx

# ── Pipeline tuning ───────────────────────────────────────
WHISPER_MODEL=large-v3
DATA_DIR=/data
ARCHIVE_AUDIO=true
AUDIO_ARCHIVE_BITRATE=64k
FEED_POLL_INTERVAL_HOURS=24
CELERY_CONCURRENCY=1

# ── Retry configuration ───────────────────────────────────
RETRY_MAX=3                        # Max retries for transient failures
RETRY_BACKOFF_BASE=30              # Base backoff in seconds (30s → 2m → 10m)

# ── Optional overrides ────────────────────────────────────
# DATABASE_URL=
# REDIS_URL=redis://redis:6379/0
```

---

## 5. Makefile

```makefile
.PHONY: up down build logs test test-unit test-e2e migrate shell-db shell-pipeline

up:             ## Start full stack
	docker compose up -d

down:           ## Stop all services
	docker compose down

build:          ## Rebuild all images
	docker compose build

logs:           ## Follow logs for all services
	docker compose logs -f

migrate:        ## Run database migrations manually (also runs on pipeline startup)
	docker compose exec pipeline alembic upgrade head

test:           ## Run all tests
	docker compose -f docker-compose.test.yml run --rm test
	docker compose -f docker-compose.test.yml run --rm web_test

test-unit:      ## Run unit tests only (fast)
	docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v

test-e2e:       ## Run E2E tests
	docker compose -f docker-compose.test.yml run --rm web_test

shell-db:       ## Open psql shell
	docker compose exec db psql -U postgres podsearch

shell-pipeline: ## Open shell in pipeline container
	docker compose exec pipeline bash

flower:         ## Open Flower in browser
	open http://localhost:5555

web:            ## Open web app in browser
	open http://localhost:3000
```

---

## 6. Dockerfiles

### `apps/pipeline/Dockerfile`

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir poetry \
    && poetry config virtualenvs.create false \
    && poetry install --no-dev --no-interaction

COPY . .

ENV HF_HOME=/root/.cache/huggingface

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Note:** `curl` is added as a system dependency to support the Docker healthcheck (`curl -f http://localhost:8000/api/health`).

### `apps/web/Dockerfile`

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 7. Database Migrations

Managed with **Alembic**. Migrations run automatically in the `pipeline` container startup command (`alembic upgrade head`) before FastAPI starts. The pipeline healthcheck ensures downstream services (`web`, `worker`) do not start until this completes.

```bash
# Create migration after changing SQLAlchemy models
docker compose exec pipeline alembic revision --autogenerate -m "add error_class and diarization_error"

# Apply manually if needed
make migrate

# Check current state
docker compose exec pipeline alembic current
```

---

## 8. CI/CD (GitHub Actions)

```yaml
name: CI
on: [push, pull_request]

jobs:
  test-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run pipeline unit tests
        run: |
          docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v --cov=app
        env:
          HF_TOKEN: ${{ secrets.HF_TOKEN }}

  test-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: apps/web/package-lock.json
      - run: cd apps/web && npm ci && npm test

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint Python
        run: cd apps/pipeline && pip install ruff && ruff check .
      - name: Lint TypeScript
        run: cd apps/web && npm ci && npm run lint
```

Integration and E2E tests are not run in CI (slow, require HF_TOKEN with pyannote access). Run locally before merging significant changes.

---

## 9. First-Time Setup Guide

```bash
# 1. Clone
git clone https://github.com/yourusername/podsearch.git
cd podsearch

# 2. Configure
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and HF_TOKEN
# Accept pyannote license at: https://huggingface.co/pyannote/speaker-diarization-3.1

# 3. Build and start
make build
make up

# 4. Open the app
open http://localhost:3000
open http://localhost:5555   # Flower queue monitor

# On first run:
# - Migrations run automatically in the pipeline container
# - Worker downloads Whisper + pyannote weights (~3 GB) before processing any jobs
# - The web UI shows a "Worker initializing" banner during this phase
# - Expect 5–20 minutes before the first job can start, depending on download speed
```

---

## 10. Open Source Considerations

- All code: **MIT License**
- Whisper weights: MIT (OpenAI)
- pyannote models: Non-commercial research license (user must accept independently)
- Users are responsible for copyright compliance with podcast audio

---

## 11. Future: Remote Deployment (V2)

- Caddy or Nginx reverse proxy with TLS
- NextAuth.js magic-link authentication
- Docker Compose production profile (`--profile production`)
- Intentionally out of scope for V1
