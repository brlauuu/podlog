# Installation

Get Podlog running on your machine in about 5 minutes.

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB+ |
| Disk | 15 GB free | 20 GB+ |
| GPU | Not required | Not required |

Podlog runs entirely on CPU. For detailed benchmarks and storage estimates by library size, see [Hardware & Performance](11-hardware.md).

## Prerequisites

1. **Docker** with **Compose V2** — [install Docker](https://docs.docker.com/get-docker/)
   ```bash
   docker compose version   # verify
   ```

2. **HuggingFace account** — [create one](https://huggingface.co/join) (free), then [generate an access token](https://huggingface.co/settings/tokens) (read access is sufficient)

3. **Accept the pyannote license** — visit [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and click "Agree and access repository." Without this, speaker diarization will silently fail.

4. **PostgreSQL client tools** (optional, for health monitoring) — needed by the host-level health check script:
   ```bash
   # Ubuntu/Debian
   sudo apt install postgresql-client

   # macOS
   brew install libpq
   ```

## Setup

```bash
# Clone the repo
git clone https://github.com/brlauuu/podlog.git
cd podlog

# Create your config file
cp .env.example .env
```

Edit `.env` and set the two required variables:

```bash
POSTGRES_PASSWORD=choose-a-strong-password
HF_TOKEN=hf_your_token_here
```

Everything else has sensible defaults. See [Configuration](10-configuration.md) for tuning options.

## Build and Start

```bash
make build    # Build Docker images (first time takes a few minutes)
make up       # Start all services in the background
```

Open **http://localhost:3000** — you should see the Podlog search page.

## What's Running

Podlog starts 5 containers:

| Service | Port | Role |
|---|---|---|
| **web** | 3000 | Next.js frontend — search, episodes, queue |
| **pipeline** | 8000 | FastAPI control plane — feed management, health |
| **worker** | — | Processes episodes: download, transcribe, diarize, archive |
| **db** | 5432 | PostgreSQL 15 with pgvector for FTS + semantic search |
| **ollama** | 11434 | Local LLM inference for RAG-based Ask AI feature |

No Redis, no Celery — the job queue is PostgreSQL-backed.

## Common Commands

```bash
make up              # Start all services
make down            # Stop all services
make build           # Rebuild Docker images
make logs            # Follow logs for all services
make shell-db        # Open a psql shell
make test-unit       # Run unit tests
make health-install  # Install health monitoring cron job (every 15 min)
make health-check    # Run health check once (manual)
make help            # List all available commands
```

---

**Next:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
