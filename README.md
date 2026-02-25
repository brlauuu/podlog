# Podlog

Self-hosted podcast transcription and search. Add RSS feeds, automatically transcribe episodes with Whisper, label speakers with pyannote, and search across all your transcripts.

Runs entirely in Docker — no cloud services, no API keys except a free HuggingFace token.

## Requirements

- Docker and Docker Compose V2
- 16 GB RAM recommended (8 GB minimum — set `WHISPER_MODEL=medium` or `small`)
- ~15 GB free disk for models, Docker images, and initial library
- CPU-only is supported; no GPU required

## Setup

```bash
# 1. Clone
git clone https://github.com/yourusername/podlog.git
cd podlog

# 2. Configure
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<a strong password>
#   HF_TOKEN=<your HuggingFace token>
#
# You must also accept the pyannote license at:
# https://huggingface.co/pyannote/speaker-diarization-3.1

# 3. Build and start
make build
make up

# 4. Open the app
open http://localhost:3000       # Podlog web UI
open http://localhost:5555       # Flower queue monitor
```

On first run:
- Database migrations run automatically
- The worker downloads Whisper + pyannote model weights (~3 GB) before processing any jobs
- The web UI shows a "Worker initializing" banner during this phase
- Expect 5–20 minutes before the first job can start, depending on download speed

## Processing time (CPU-only, Whisper large-v3)

| Machine | 1-hour episode |
|---|---|
| Modern 8-core (e.g. AMD Ryzen 7) | ~30–45 min |
| Older 4-core (e.g. Intel Core i5) | ~60–90 min |
| Low-power (e.g. Intel NUC) | ~90–150 min |

To reduce memory and processing time, set `WHISPER_MODEL=medium` or `WHISPER_MODEL=small` in `.env`.

## Storage

For a 1,000-episode library (1 hour average, audio archived at 64 kbps):

| Component | Size |
|---|---|
| Model cache (one-time) | ~4 GB |
| Docker images | ~3–4 GB |
| Audio archive | ~3.5 GB |
| PostgreSQL | ~1–1.5 GB |
| **Total** | **~12–13 GB** |

Set `ARCHIVE_AUDIO=false` to skip audio archival and save disk space (transcripts remain fully searchable).

## Common commands

```bash
make up              # Start everything
make down            # Stop everything
make logs            # Follow all logs
make test-unit       # Run unit tests (fast)
make shell-db        # Open psql
make shell-pipeline  # Open pipeline container shell
```

## Architecture

```
┌─ Docker Compose ──────────────────────────────────────────┐
│                                                            │
│  db (PostgreSQL 15)     redis (Redis 7)                    │
│       │                      │                             │
│  pipeline (FastAPI :8000) ───┤                             │
│       │                      │                             │
│  worker (Celery) ────────────┤  Whisper → pyannote         │
│  beat  (Celery Beat)         │  sequential, not concurrent │
│  flower (Flower :5555)       │                             │
│       │                                                    │
│  web  (Next.js :3000) ── reads DB directly for search      │
│                         calls pipeline API for management   │
└────────────────────────────────────────────────────────────┘
```

## License

MIT. See [LICENSE](LICENSE).

pyannote models are subject to their own non-commercial research license — you must accept this independently on HuggingFace.
