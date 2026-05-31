<div align="center">

<img src="apps/web/public/brand/podlog-logo-dark-theme.svg" alt="Podlog" width="420" />

**Self-hosted audio transcription and comprehensive search web app**


![Python](https://img.shields.io/badge/python-3.11-3776ab?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/node-20-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/postgresql-15-4169e1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-O'Saasy-green)
![Next.js](https://img.shields.io/badge/next.js-16.2.4-black?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/react-19.2.5-149eca?logo=react&logoColor=white)
[![CI Fast](https://github.com/brlauuu/podlog/actions/workflows/ci.yml/badge.svg)](https://github.com/brlauuu/podlog/actions/workflows/ci.yml)
[![CI Full Unit](https://github.com/brlauuu/podlog/actions/workflows/ci-full-unit.yml/badge.svg)](https://github.com/brlauuu/podlog/actions/workflows/ci-full-unit.yml)
[![CI Slow (integration/e2e)](https://github.com/brlauuu/podlog/actions/workflows/ci-slow.yml/badge.svg)](https://github.com/brlauuu/podlog/actions/workflows/ci-slow.yml)

</div>

## Features

- **Audio ingestion** — pull episodes from RSS feeds (full, selective, or test mode) or upload audio files (`.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac`, `.opus`, `.aac`, `.wma`, `.webm`, `.mp4`) directly from the web UI.
- **Speech-to-text** — WhisperX with `large-v3-turbo` by default, tunable down to `tiny` for low-RAM machines.
- **Speaker diarization** — pyannote `speaker-diarization-community-1` assigns `SPEAKER_NN` labels locally (free), with an optional paid cloud upgrade to pyannote.ai's higher-accuracy `precision-2` model; spaCy NER proposes real names from episode metadata, and you can rename or merge speakers in the UI.
- **Hybrid search** — full-text keyword search (`"exact phrase"`, `OR`, `-exclude`) combined with pgvector semantic similarity, merged via Reciprocal Rank Fusion.
- **Persistent audio player** — click any timestamp to play; the player keeps going while you navigate other pages.
- **Ask AI (RAG)** — ask natural-language questions and get streamed, citation-backed answers drawn from your transcript library (local Ollama by default, Fireworks optional).
- **Export** — download search results or full transcripts as Markdown or plain text, or open a print-friendly view (`/search/print`) for the browser's print-to-PDF flow.
- **Queue dashboard** — per-stage status, error classification, auto-retry for transient failures, manual retry for the rest.
- **Meta-Analysis dashboard** — cross-feed metrics (episode counts, durations, WPM, turn density, host/guest share, processing time, token and cost totals) with drill-down charts at `/meta-analysis`.
- **Notifications** — Telegram and email alerts when episodes finish or fail, with optional daily/weekly digest.
- **Local-first** — no accounts, no cloud, no telemetry; optional Fireworks AI profile for users who prefer remote inference.


## Quick Start

```bash
# 1. Clone
git clone https://github.com/brlauuu/podlog.git
cd podlog

# 2. Configure (set POSTGRES_PASSWORD and HF_TOKEN)
cp .env.example .env
nano .env

# 3. Build and start
make build
make up
```

Open **http://localhost:3000**. From the navbar you can reach Search (`/search`), Ask (`/ask`), Sources (`/podcasts`, where you add feeds or upload audio), Queue (`/queue`), Meta-Analysis (`/meta-analysis`), Settings (`/settings`), Docs (`/docs`) and About (`/about`).

> **First run:** The worker downloads Whisper and pyannote model weights (~3 GB). Jobs are queued during this phase and start processing once models are cached.

### Remote-Inference Profile (Optional)

If you want Fireworks-backed inference and no local `ollama` container:

```bash
# ensure FIREWORKS_API_KEY is set in .env
make up-remote
```

This uses `docker-compose.remote.yml` on top of the default compose file.

For a side-by-side comparison of the local and remote options for both transcription and diarization — including a decision matrix and a list of providers we evaluated but didn't ship — see [docs/guide/19-inference-providers.md](docs/guide/19-inference-providers.md).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with [Compose V2](https://docs.docker.com/compose/install/)
- A free [HuggingFace](https://huggingface.co) account with an access token
- You **must accept the pyannote license** at [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) before diarization will work
- `postgresql-client` (optional) — needed for host-level health monitoring (`sudo apt install postgresql-client`)

## Architecture

```
                        ┌──────────────────────────────────────────────┐
  Browser :3000  ──────>│  web (Next.js 16.2.4)                        │
                        │    Home, search, episodes, queue, audio player│
                        │    Reads PostgreSQL directly for FTS/vector  │
                        │    Proxies to pipeline API for management    │
                        └──────────────┬───────────────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────────────┐
  Pipeline API :8000 ──>│  pipeline (FastAPI)                          │
                        │    Feed management, queue control, health    │
                        │    Embed API (MiniLM query embedding)        │
                        └──────────────────────────────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────────────┐
                        │  worker (Python)                             │
                        │    download → transcribe → diarize → chunk  │
                        │    → embed → infer speakers → archive        │
                        │    Sequential processing (concurrency=1)     │
                        │    Whisper + pyannote never in memory at once│
                        └──────────────┬───────────────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────────────┐
                        │  db (PostgreSQL 15 + pgvector)               │
                        │    Episodes, segments, speaker names         │
                        │    FTS via GIN index + vector HNSW index     │
                        │    Job queue with FOR UPDATE SKIP LOCKED     │
                        └──────────────────────────────────────────────┘

                        ┌──────────────────────────────────────────────┐
  Ollama API :11434 ──> │  ollama (local LLM)                          │
                        │    RAG-based Ask AI feature                  │
                        └──────────────────────────────────────────────┘
```

Default profile: 5 containers (`db`, `pipeline`, `worker`, `ollama`, `web`). Remote-inference profile: 4 containers (Ollama is disabled unless you opt in with the `local-ask` Compose profile). No Redis, no Celery — the job queue is PostgreSQL-backed using `FOR UPDATE SKIP LOCKED`.

## Configuration

Only two variables are required. Everything else has sensible defaults.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | *(required)* | PostgreSQL password |
| `HF_TOKEN` | *(required)* | HuggingFace access token for pyannote |
| `WHISPER_MODEL` | `large-v3-turbo` | Model size: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8` (fast, recommended for CPU) or `float32` |
| `ARCHIVE_AUDIO` | `true` | Archive audio as compressed MP3 after transcription |
| `FEED_POLL_INTERVAL_HOURS` | `24` | How often to check feeds for new episodes |

See [docs/configuration.md](docs/configuration.md) for the full list of all environment variables.

## Documentation

| Document | Description |
|---|---|
| [Changelog](CHANGELOG.md) | Notable changes per release. Also rendered at the bottom of the in-app About page. |
| [User Guide](docs/guide/) | Step-by-step guide for new users: setup, features, configuration |
| [Configuration](docs/configuration.md) | All environment variables with defaults and explanations |
| [Hardware Guide](docs/hardware.md) | System requirements, processing benchmarks, tested machine specs |
| [Development](docs/development.md) | Local development setup, running tests, architecture notes, and Codex/Claude audit workflows |
| [Audit Workflows](docs/development.md#audit-workflows) | How Codex (`nightly-audit`) and Claude (`/codebase-audit`) audits are run, what they produce, and safety constraints |
| [Episode Lifecycle](docs/episode-lifecycle.md) | Pipeline stages, data produced at each step, and which features depend on which data |

## Common Commands

```bash
make up              # Start all services
make up-remote       # Start Fireworks remote-inference profile
make down            # Stop all services
make down-remote     # Stop Fireworks remote-inference profile
make build           # Rebuild Docker images
make logs            # Follow logs for all services
make logs-remote     # Follow logs for remote-inference profile
make test-unit       # Run pipeline unit tests + healthcheck script tests
make shell-db        # Open psql shell
make health-install  # Install health monitoring cron (every 15 min)
make help            # List all available commands
```

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| [WhisperX](https://github.com/m-bain/whisperX) | Whisper large-v3-turbo + CTranslate2 | Speech-to-text transcription |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | CTranslate2 backend | Fast CPU inference for Whisper |
| [pyannote](https://github.com/pyannote/pyannote-audio) | `speaker-diarization-community-1` (local) or `precision-2` (pyannote.ai cloud) | Speaker labeling and separation |
| [sentence-transformers](https://www.sbert.net/) | all-MiniLM-L6-v2 | Semantic search embeddings (384-dim) |
| [pgvector](https://github.com/pgvector/pgvector) | PostgreSQL vector extension | Approximate nearest neighbor search |
| [Next.js](https://nextjs.org/) 16.2.4 | App Router, React Server Components | Web UI |
| [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) | Utility-first CSS + components | Styling |
| [FastAPI](https://fastapi.tiangolo.com/) | Python async web framework | Pipeline API |
| [PostgreSQL](https://www.postgresql.org/) 15 | Relational database | Storage, FTS, job queue, vector search |
| [Docker Compose](https://docs.docker.com/compose/) | Container orchestration | Deployment |

## Credits

Built by [@brlauuu](https://github.com/brlauuu) with support from:

Agents:

- [Claude](https://claude.ai)
- [Gemini](https://gemini.google.com)
- [OpenCode](https://opencode.ai) (running [Kimi K2.5](https://platform.kimi.com/docs/guide/kimi-k2-5-quickstart) and [Big Pickle](https://opencode.ai))

Platforms:

- [Omnara](https://omnara.cc)
- [Fireworks AI](https://fireworks.ai) (optional remote inference for Podlog)

## License

[O'Saasy License](https://osaasy.dev). See [LICENSE](LICENSE).

**pyannote models** are subject to their own license — you must accept this independently at [huggingface.co/pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1). Users are responsible for copyright compliance with podcast audio content.

## Disclaimer

This software is an open-source tool for audio transcription. It does not include any copyrighted content. Users are responsible for ensuring their use of the software complies with local copyright laws and the Terms of Service of any content creators whose work they process.
