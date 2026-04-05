<div align="center">

# Podlog

**Self-hosted podcast transcription, diarization, search, and local AI Q&A**

Runs locally in Docker with a Next.js web UI, a FastAPI control plane, a Python worker, PostgreSQL + pgvector, and Ollama for on-box transcript Q&A.

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)
![React](https://img.shields.io/badge/React-18.3-149ECA?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-0.3-4B8BBE)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-5_services-2496ED?logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-338_defined-6A5ACD)
![Verification](https://img.shields.io/badge/verification-blocked_by_poetry_lock-C05621)
![License](https://img.shields.io/badge/license-O'Saasy-2F855A)

</div>

## What It Does

- Ingests podcast feeds from RSS and manages them from a local web UI
- Transcribes episodes with WhisperX and diarizes speakers with pyannote
- Supports keyword search and semantic transcript search backed by PostgreSQL + pgvector
- Provides episode pages with speaker editing, merging, timestamps, and persistent audio playback
- Runs Ask AI against your processed episodes through a local Ollama service
- Exposes queue status, retries, and reprocessing flows without adding Redis or Celery

## Quick Start

```bash
git clone https://github.com/brlauuu/podlog.git
cd podlog
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD and HF_TOKEN
make build
make up
```

Open `http://localhost:3000`.

First boot downloads Whisper and pyannote model weights and warms the worker cache, so the first processing run is slower than normal.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose V2
- A [HuggingFace](https://huggingface.co) access token for pyannote model access
- Acceptance of the [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) license
- Enough CPU, RAM, and disk for local model downloads and transcript storage
- Ollama for the Ask AI workflow included in the default compose stack

## Runtime Overview

| Service | Tech | Purpose |
|---|---|---|
| `web` | Next.js 14 + React 18 | Search UI, episode pages, queue, feeds, notifications |
| `pipeline` | FastAPI | Feed management, health, backfill, control-plane API |
| `worker` | Python 3.11 | Download, transcribe, diarize, chunk, embed, infer, archive |
| `db` | PostgreSQL 15 + pgvector | Storage, full-text search, vector search, queue state |
| `ollama` | Ollama | Local LLM runtime for Ask AI |

The default deployment is five containers. Queueing is PostgreSQL-backed, so there is no separate Redis or Celery layer to operate.

## Documentation

| Document | Description |
|---|---|
| [User Guide](docs/guide/README.md) | Step-by-step setup and feature guide for first-time operators |
| [Configuration](docs/configuration.md) | Environment variables and runtime tuning |
| [Hardware Guide](docs/hardware.md) | Machine sizing, benchmarks, and storage expectations |
| [Episode Lifecycle](docs/episode-lifecycle.md) | Processing stages from ingest to done |
| [Development Guide](docs/development.md) | Local development, tests, and project structure |

## Common Commands

```bash
make up
make down
make build
make logs
make test
make test-unit
make test-e2e
make shell-db
```

## Development

Contributor setup, project structure, and local test workflows live in [docs/development.md](docs/development.md). The README stays focused on evaluating and running Podlog rather than serving as the full contributor manual.

## License

Podlog is licensed under the [O'Saasy License](LICENSE).

The pyannote models used for speaker diarization are licensed separately. You must accept that license independently at [huggingface.co/pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1).

Users remain responsible for copyright compliance when downloading, storing, and processing podcast audio.
