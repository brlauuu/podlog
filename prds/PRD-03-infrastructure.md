# PRD-03: Project Infrastructure, Repository Structure & Docker Setup

**Project:** Podlog — Self-hosted Podcast Transcription & Search  
**Document:** PRD-03 — Infrastructure & DevOps  
**Version:** 1.4
**Status:** Active
**Author:** Claude (generated from user specification)
**Changelog:**
- v1.4 — Added optional Fireworks inference provider configuration (env + DB-backed Settings UI overrides). Updated `.env.example` with inference-provider variables. Updated web navigation from Notifications page to broader Settings page.
- v1.3 — Major update to match actual implementation: Celery/Redis/Flower/Beat removed; PostgreSQL-backed job queue with worker.py. Redis service and volumes removed from docker-compose. Single Dockerfile replaced by Dockerfile.control and Dockerfile.worker. Repo structure updated with actual files (removed scheduler.py, celery_app.py, SearchBar.tsx, SpeakerLabel.tsx; added worker.py and current component list). Test stack updated (no redis_test). License corrected to O'Saasy. Makefile updated with all current targets. Ollama service added. .env.example updated to match actual vars.
- v1.2 — Renamed project from PodSearch to Podlog. Database name changed to `podlog`. Added `redis_test` service to `docker-compose.test.yml`. Changed `beat` dependency from `- worker` to `pipeline: service_healthy`. Added `CELERY_CONCURRENCY` env var interpolation in worker command. Added `DISK_HEADROOM_BYTES` to `.env.example`. Repository root directory renamed from `podsearch/` to `podlog/`.
- v1.1 — Pipeline service healthcheck added; `web` dependency changed from `service_started` to `service_healthy` to close migration race condition; `docker-compose.yml` updated to reflect new `error_class`, `retry_count`, `diarization_error` schema fields; model pre-warm documented in worker startup.

---

## 1. Purpose

This document covers everything that spans PRD-01 and PRD-02: the monorepo layout, Docker Compose configuration, CI/CD, environment management, and contributor setup. It is the "glue" document that lets a developer clone the repo and have a running system in one command.

---

## 2. Repository Structure

```
podlog/
├── docker-compose.yml
├── docker-compose.test.yml
├── docker-compose.override.yml     # gitignored
├── .env.example
├── .env                            # gitignored
├── Makefile
├── README.md
├── LICENSE                         # O'Saasy
│
├── apps/
│   ├── pipeline/
│   │   ├── Dockerfile.control      # FastAPI API server
│   │   ├── Dockerfile.worker       # ML worker (WhisperX, pyannote)
│   │   ├── pyproject.toml
│   │   ├── poetry.lock
│   │   ├── alembic/
│   │   │   ├── env.py
│   │   │   └── versions/           # 10 migrations
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   ├── models.py
│   │   │   ├── job_queue.py        # PostgreSQL-backed job queue
│   │   │   ├── worker.py           # Background job worker + feed polling loop
│   │   │   ├── api/
│   │   │   │   ├── feeds.py
│   │   │   │   ├── episodes.py
│   │   │   │   ├── queue.py
│   │   │   │   ├── health.py       # Returns WARMING_UP | OK
│   │   │   │   ├── ask.py          # RAG-based Ask AI endpoint
│   │   │   │   ├── notifications.py
│   │   │   │   └── backfill.py
│   │   │   ├── tasks/
│   │   │   │   ├── ingest.py
│   │   │   │   ├── download.py     # Auto-retry logic with error classification
│   │   │   │   ├── transcribe.py   # Explicit model unload after transcription
│   │   │   │   ├── diarize.py      # Graceful failure path
│   │   │   │   ├── chunk.py        # Transcript chunking for embeddings
│   │   │   │   ├── embed.py        # Vector embedding generation
│   │   │   │   ├── infer.py        # Host/guest inference
│   │   │   │   ├── archive.py      # Disk-full handling
│   │   │   │   └── prewarm.py      # Model pre-warm on worker startup
│   │   │   └── services/
│   │   │       ├── rss.py
│   │   │       ├── whisper.py      # WhisperX (CTranslate2 backend)
│   │   │       ├── pyannote.py
│   │   │       ├── alignment.py    # Majority-overlap timestamp merging
│   │   │       ├── chunking.py
│   │   │       ├── embed.py
│   │   │       ├── rag.py          # Ollama RAG service
│   │   │       ├── inference.py
│   │   │       ├── notifications.py
│   │   │       └── events.py
│   │   └── tests/
│   │       ├── fixtures/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── e2e/
│   │
│   └── web/
│       ├── Dockerfile
│       ├── package.json
│       ├── package-lock.json
│       ├── next.config.ts
│       ├── tailwind.config.ts      # dark mode: 'class' strategy
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx      # Root layout with AudioPlayerContext + global player
│       │   │   ├── page.tsx
│       │   │   ├── podcasts/
│       │   │   ├── episodes/[id]/
│       │   │   ├── queue/
│       │   │   ├── feeds/
│       │   │   ├── ask/
│       │   │   ├── search/
│       │   │   ├── settings/
│       │   │   └── api/
│       │   │       ├── search/     # grouped + mentions routes
│       │   │       ├── feeds/
│       │   │       ├── queue/
│       │   │       ├── wizard/
│       │   │       ├── notifications/
│       │   │       └── audio/
│       │   │           └── [episodeId]/
│       │   │               └── [filename]/
│       │   │                   └── route.ts  # Path-validated audio serving
│       │   ├── components/
│       │   │   ├── ui/             # 12 shadcn/ui components
│       │   │   ├── Navbar.tsx
│       │   │   ├── SearchResult.tsx
│       │   │   ├── AudioPlayer.tsx
│       │   │   ├── AudioPlayerContext.tsx
│       │   │   ├── DarkModeToggle.tsx
│       │   │   ├── QueueStatus.tsx
│       │   │   ├── SetupWizard.tsx
│       │   │   ├── SpeakerPanel.tsx
│       │   │   ├── MergeBar.tsx
│       │   │   ├── NotificationSettings.tsx
│       │   │   └── ...
│       │   └── lib/
│       │       ├── db.ts
│       │       ├── search.ts
│       │       ├── pipeline.ts
│       │       ├── timestamp.ts
│       │       └── types.ts
│       └── tests/
│           ├── unit/
│           └── e2e/
```

---

## 3. Docker Compose

### 3.1 Production-like Local Stack (`docker-compose.yml`)

```yaml
services:
  db:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: podlog
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  pipeline:
    build:
      context: ./apps/pipeline
      dockerfile: Dockerfile.control
    command: >
      sh -c "alembic upgrade head &&
             uvicorn app.main:app --host 0.0.0.0 --port 8000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podlog
    ports:
      - "8000:8000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - audio_data:/data/audio
      - transcript_data:/data/transcripts
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  worker:
    build:
      context: ./apps/pipeline
      dockerfile: Dockerfile.worker
    command: >
      sh -c "python -m app.tasks.prewarm && python -m app.worker"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podlog
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - audio_data:/data/audio
      - transcript_data:/data/transcripts
      - model_cache:/root/.cache/huggingface
    depends_on:
      db:
        condition: service_healthy
      pipeline:
        condition: service_healthy  # Ensures migrations are done before worker writes to DB

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    deploy:
      resources:
        limits:
          memory: 6g

  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/podlog
      PIPELINE_API_URL: http://pipeline:8000
    volumes:
      - audio_data:/data/audio:ro
    depends_on:
      db:
        condition: service_healthy
      pipeline:
        condition: service_healthy  # Waits for migrations -- prevents schema-not-found errors

volumes:
  postgres_data:
  audio_data:
  transcript_data:
  model_cache:
  ollama_data:
```

**5 services:** db, pipeline, worker, ollama, web. No external broker (Redis removed) — the job queue is PostgreSQL-backed. No Celery Beat or Flower.

**Key design points:**
- `pipeline` uses `Dockerfile.control` (lightweight FastAPI server); `worker` uses `Dockerfile.worker` (includes ML dependencies).
- `pipeline` healthcheck ensures migrations complete before downstream services start.
- `worker` runs `prewarm.py` then `worker.py` (which includes both job processing and feed polling).
- `ollama` provides local LLM inference for the Ask AI feature.
- `db` uses `pgvector/pgvector:pg15` for vector embedding support.

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
      POSTGRES_DB: podlog_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: test
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  mock_rss:
    image: nginx:alpine
    volumes:
      - ./apps/pipeline/tests/fixtures:/usr/share/nginx/html:ro

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

**Note:** `web_test` service is currently disabled pending a pipeline_test service in the test stack (see issue #104).

---

## 4. Environment Variables

### `.env.example`

```env
# ── Required ──────────────────────────────────────────────
POSTGRES_PASSWORD=changeme
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx

# ── Pipeline tuning ───────────────────────────────────────
WHISPER_MODEL=large-v3-turbo       # tiny|base|small|medium|large-v3|large-v3-turbo
WHISPER_COMPUTE_TYPE=int8          # int8 (fast, recommended for CPU) | float32 (accurate)
WHISPER_BATCH_SIZE=16              # WhisperX batched inference batch size
DATA_DIR=/data
ARCHIVE_AUDIO=true
AUDIO_ARCHIVE_BITRATE=64k
FEED_POLL_INTERVAL_HOURS=24

# ── Retry configuration ───────────────────────────────────
RETRY_MAX=3                        # Max retries for transient failures
RETRY_BACKOFF_BASE=30              # Base backoff in seconds (30s → 2m → 10m)

# ── Disk space guard (GAP-06) ─────────────────────────────
DISK_HEADROOM_BYTES=2147483648     # 2 GB minimum free space before download starts

# ── Ollama (RAG) ─────────────────────────────────────────
OLLAMA_URL=http://ollama:11434     # Ollama API endpoint for LLM inference

# ── Inference provider (optional) ───────────────────────
# INFERENCE_PROVIDER=local          # local | fireworks
# FIREWORKS_API_KEY=
# FIREWORKS_AUDIO_BASE_URL=https://audio-turbo.api.fireworks.ai
# FIREWORKS_STT_MODEL=whisper-v3-large
# FIREWORKS_STT_DIARIZE=true

# ── Optional overrides ────────────────────────────────────
# DATABASE_URL=postgresql://postgres:changeme@db:5432/podlog
```

---

## 5. Makefile

```makefile
.PHONY: up down build logs test test-unit test-integration test-e2e migrate \
        shell-db shell-pipeline shell-web web ollama-pull \
        health-check health-install health-uninstall help

up:               ## Start full stack
	docker compose up -d

down:             ## Stop all services
	docker compose down

build:            ## Rebuild all images
	docker compose build

logs:             ## Follow logs for all services
	docker compose logs -f

migrate:          ## Run database migrations manually (also runs on pipeline startup)
	docker compose exec pipeline alembic upgrade head

test:             ## Run all tests (unit + e2e)
	docker compose -f docker-compose.test.yml run --rm test
	docker compose -f docker-compose.test.yml run --rm web_test

test-unit:        ## Run unit tests only (fast, no Docker required for ML models)
	docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v

test-integration: ## Run integration tests (requires HF_TOKEN for pyannote)
	...

test-e2e:         ## Run Playwright end-to-end tests
	docker compose -f docker-compose.test.yml run --rm web_test

shell-db:         ## Open psql shell
	docker compose exec db psql -U postgres podlog

shell-pipeline:   ## Open shell in pipeline container
	docker compose exec pipeline bash

shell-web:        ## Open shell in web container
	docker compose exec web sh

web:              ## Open web app in browser
	open http://localhost:3000

ollama-pull:      ## Pull default Ollama model (Qwen2.5-3B Q4)
	...

health-check:     ## Run health check once
	...

health-install:   ## Install health check cron job (every 15 min)
	...

health-uninstall: ## Remove health check cron job
	...

help:             ## Show this help
	...
```

---

## 6. Dockerfiles

### `apps/pipeline/Dockerfile.control`

Lightweight image for the FastAPI API server. Does not include ML dependencies (WhisperX, pyannote).

```dockerfile
FROM python:3.11-slim
# curl for healthcheck, ffmpeg for audio processing
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml poetry.lock .
RUN pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-dev --no-interaction
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `apps/pipeline/Dockerfile.worker`

Full ML image with WhisperX, pyannote, and all model dependencies. Larger image due to torch and audio ML libs.

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml poetry.lock .
RUN pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-interaction
COPY . .
ENV HF_HOME=/root/.cache/huggingface
CMD ["python", "-m", "app.worker"]
```

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
git clone https://github.com/yourusername/podlog.git
cd podlog

# 2. Configure
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and HF_TOKEN
# Accept pyannote license at: https://huggingface.co/pyannote/speaker-diarization-3.1

# 3. Build and start
make build
make up

# 4. Open the app
open http://localhost:3000

# On first run:
# - Migrations run automatically in the pipeline container
# - Worker downloads Whisper + pyannote weights (~3 GB) before processing any jobs
# - The web UI shows a "Worker initializing" banner during this phase
# - Expect 5–20 minutes before the first job can start, depending on download speed
```

---

## 10. Open Source Considerations

- All code: **O'Saasy License**
- Whisper weights: MIT (OpenAI)
- pyannote models: Non-commercial research license (user must accept independently)
- Users are responsible for copyright compliance with podcast audio

---

## 11. Future: Remote Deployment (V2)

- Caddy or Nginx reverse proxy with TLS
- NextAuth.js magic-link authentication
- Docker Compose production profile (`--profile production`)
- Intentionally out of scope for V1
