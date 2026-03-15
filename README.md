# Podlog

Self-hosted podcast transcription and search. Add RSS feeds, automatically transcribe episodes with [Whisper](https://github.com/openai/whisper), label speakers with [pyannote](https://github.com/pyannote/pyannote-audio), and search across all your transcripts — all running locally in Docker.

## Features

- **Full-text search** across all podcast transcripts with highlighted results and timestamp links
- **Speaker diarization** — automatic speaker labeling (SPEAKER_00, SPEAKER_01) with per-episode renaming
- **Persistent audio player** — click a timestamp to play from that point, player continues across pages
- **Queue dashboard** — live progress, error classification, auto-retry on transient failures
- **Dark mode** — toggleable, remembers your preference
- **RSS feed management** — add feeds, auto-poll every 24 hours for new episodes
- **No cloud dependencies** — everything runs locally, no data leaves your machine

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB |
| Storage (base) | 15 GB (Docker images + model cache) | 20 GB |
| Storage (per 1000 episodes) | ~5 GB (with audio archive) | — |

**RAM note:** Whisper large-v3 uses ~3.5 GB during transcription. On 8 GB machines, set `WHISPER_MODEL=medium` or `WHISPER_MODEL=small` in `.env` to reduce memory usage (trades accuracy for ~2–4x less RAM).

**CPU note:** Whisper inference is single-threaded. More cores help keep the rest of the system (PostgreSQL, Next.js) responsive while the worker runs, but won't speed up individual transcriptions.

**GPU:** Not required. CPU-only is fully supported and is the default.

## Prerequisites

- **Docker** and **Docker Compose V2** (comes with Docker Desktop, or install the `docker-compose-plugin` package)
- A **HuggingFace account** with an access token (free)

### Getting a HuggingFace Token

1. Create an account at [huggingface.co](https://huggingface.co)
2. Go to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
3. Create a new token (read access is sufficient)
4. **Accept the pyannote license** — visit [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and click "Agree and access repository". Without this step, diarization will fail.

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/podlog.git
cd podlog

# 2. Configure environment
cp .env.example .env
```

Edit `.env` and set these required values:

```env
POSTGRES_PASSWORD=<a strong password>
HF_TOKEN=<your HuggingFace access token>
```

```bash
# 3. Build and start
make build
make up

# 4. Open the app
# Web UI:       http://localhost:3000
# Flower:       http://localhost:5555  (queue monitor)
# Pipeline API: http://localhost:8000  (internal)
```

### First Run

On the very first startup:
- Database migrations run automatically
- The worker downloads Whisper and pyannote model weights (~3 GB)
- The web UI displays a "Worker initializing" banner during this phase
- Jobs submitted during warm-up are queued but won't start processing until download completes

## Configuration

All configuration is via environment variables in `.env`. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | *(required)* | PostgreSQL password |
| `HF_TOKEN` | *(required)* | HuggingFace access token for pyannote model download |
| `WHISPER_MODEL` | `large-v3` | Whisper model size: `tiny`, `base`, `small`, `medium`, `large-v3` |
| `ARCHIVE_AUDIO` | `true` | Archive audio as 64kbps MP3 after transcription. Set `false` to delete audio and save disk. |
| `AUDIO_ARCHIVE_BITRATE` | `64k` | MP3 bitrate for archived audio |
| `FEED_POLL_INTERVAL_HOURS` | `24` | How often to check RSS feeds for new episodes |
| `CELERY_CONCURRENCY` | `1` | Number of worker processes. Keep at 1 on CPU-only machines. |
| `RETRY_MAX` | `3` | Max auto-retries for transient download failures |
| `DISK_HEADROOM_BYTES` | `2147483648` | Minimum free disk space (bytes) before starting a download (default: 2 GB) |

## Processing Time (CPU-only, Whisper large-v3)

| Machine | 1-hour episode | 3-hour episode |
|---|---|---|
| Modern 8-core (e.g. AMD Ryzen 7) | ~30–45 min | ~90–135 min |
| Older 4-core (e.g. Intel Core i5 7th gen) | ~60–90 min | ~3–4.5 hours |
| Low-power (e.g. Intel NUC, ARM) | ~90–150 min | ~4.5–7.5 hours |

Diarization adds approximately 20–30% on top of transcription time.

## Storage Estimates

With audio archival enabled (64 kbps MP3):

| Episodes (1hr avg) | Audio Archive | Database | Total (incl. base) |
|---|---|---|---|
| 100 | ~0.4 GB | ~150 MB | ~16 GB |
| 500 | ~2 GB | ~750 MB | ~18 GB |
| 1,000 | ~3.5 GB | ~1.5 GB | ~20 GB |
| 5,000 | ~17 GB | ~7.5 GB | ~40 GB |

Base overhead: ~15 GB (Docker images + model cache + OS).

## Common Commands

```bash
make up                # Start all services
make down              # Stop all services
make build             # Rebuild Docker images
make logs              # Follow logs for all services
make test-unit         # Run unit tests (fast, no GPU/models needed)
make test-integration  # Run integration tests (requires HF_TOKEN)
make test-e2e          # Run Playwright end-to-end tests
make migrate           # Run database migrations manually
make shell-db          # Open psql shell
make shell-pipeline    # Open pipeline container shell
make help              # List all available commands
```

## Architecture

```
┌─ Docker Compose ──────────────────────────────────────────┐
│                                                            │
│  db (PostgreSQL 15)     redis (Redis 7)                    │
│       │                      │                             │
│  pipeline (FastAPI :8000) ───┤  Migrations on startup      │
│       │                      │                             │
│  worker (Celery) ────────────┤  Whisper → [unload] →       │
│  beat  (Celery Beat)         │  pyannote → ffmpeg          │
│  flower (Flower :5555)       │  Sequential, not concurrent │
│                                                            │
│  web  (Next.js :3000)                                      │
│    ├── reads PostgreSQL directly for search (FTS)          │
│    └── proxies to pipeline API for feed/queue management   │
└────────────────────────────────────────────────────────────┘
```

## License

[O'Saasy License](https://osaasy.dev). See [LICENSE](LICENSE).

**pyannote models** are subject to their own license — you must accept this independently at [huggingface.co/pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1). Users are responsible for copyright compliance with podcast audio content.
