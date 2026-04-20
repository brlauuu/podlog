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

3. **Accept the pyannote license** — visit [pyannote/community-1](https://huggingface.co/pyannote/community-1) and click "Agree and access repository." Without this, speaker diarization will silently fail. (If you override `PYANNOTE_MODEL` to a different pyannote release, accept the license for that model instead.)

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

If you want remote Fireworks inference mode, also set:

```bash
FIREWORKS_API_KEY=fw_your_key_here
```

## Build and Start

```bash
make build    # Build Docker images (first time takes a few minutes)
make up       # Start all services in the background
```

Open **http://localhost:3000** — you should see the Podlog home page with quick links to Search and Ask. The search page itself is at `/search`.

### Optional: Remote-Inference Profile

Use this when you want Fireworks-backed inference and no local Ollama container:

```bash
make up-remote
```

This runs `docker compose -f docker-compose.yml -f docker-compose.remote.yml up -d`.

## What's Running

Podlog starts these containers by profile:

| Profile | Services |
|---|---|
| **Local-first (`make up`)** | `web`, `pipeline`, `worker`, `db`, `ollama` |
| **Remote-inference (`make up-remote`)** | `web`, `pipeline`, `worker`, `db` (no `ollama`) |

Service details:

| Service | Port | Role |
|---|---|---|
| **web** | 3000 | Next.js frontend — home, search, episodes, queue, Ask |
| **pipeline** | 8000 | FastAPI control plane — feed management, health |
| **worker** | — | Processes episodes: download, transcribe, diarize, chunk, embed, infer, archive |
| **db** | 5432 | PostgreSQL 15 with pgvector for FTS + semantic search |
| **ollama** | 11434 | Local Ask AI generation provider (local-first profile) |

No Redis, no Celery — the job queue is PostgreSQL-backed.

## Common Commands

```bash
make up              # Start all services
make up-remote       # Start Fireworks remote-inference profile
make down            # Stop all services
make down-remote     # Stop Fireworks remote-inference profile
make build           # Rebuild Docker images
make logs            # Follow logs for all services
make logs-remote     # Follow logs for remote-inference profile
make shell-db        # Open a psql shell
make test-unit       # Run pipeline unit tests + healthcheck script tests
make health-install  # Install health monitoring cron job (every 15 min)
make health-check    # Run health check once (manual)
make help            # List all available commands
```

---

**Next:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
