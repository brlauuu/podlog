# podlog-pipeline

The Podlog ingestion pipeline: RSS fetch, audio download, Whisper transcription, pyannote diarization, chunking, embedding, speaker inference, and archival.

This package is one half of the [Podlog](../../README.md) monorepo — the other is the Next.js web app in [`apps/web`](../web). It runs as two containers built from the same source: a lightweight FastAPI control plane (`Dockerfile.control`) and a worker that carries the ML dependencies (`Dockerfile.worker`).

## Layout

```
app/
├── main.py              # FastAPI entry point; mounts every router under /api
├── config.py            # pydantic-settings — all env vars live here
├── models.py            # SQLAlchemy ORM (feeds, episodes, segments, speaker_names)
├── database.py          # Engine + session factory
├── job_queue.py         # PostgreSQL-backed job queue (enqueue, claim, complete)
├── task_registry.py     # Maps pipeline stages to task functions + next-stage routing
├── worker.py            # Background job worker + feed polling loop
├── api/                 # FastAPI routers
├── tasks/               # Pipeline stages (ingest → … → archive)
└── services/            # Business logic (rss, whisper, pyannote, rag, …)
alembic/versions/        # Migrations — auto-applied on pipeline startup
tests/{unit,integration,e2e}
```

## Running

The pipeline is normally run through Docker Compose from the repo root rather than directly:

```bash
make up            # starts db, pipeline, worker, ollama, web, backup
make logs          # follow logs
make shell-pipeline
```

For native development (Python 3.11–3.13 + [Poetry](https://python-poetry.org/)), see [`docs/development.md`](../../docs/development.md).

```bash
poetry install                 # add --with ml for the transcription/diarization stack
poetry run uvicorn app.main:app --reload
poetry run python -m app.worker
```

The `ml` dependency group (WhisperX, torch, pyannote-audio, spaCy, sentence-transformers) is **optional** and not installed by default — the API server does not need it, only the worker does.

## Tests

```bash
poetry run pytest tests/unit                    # fast, mocks the DB
poetry run pytest tests/unit --cov=app          # with coverage (CI gate: 82%)
poetry run pytest tests/integration             # needs a real test DB
```

Integration and e2e tests require Docker and, for diarization, an `HF_TOKEN`. From the repo root, `make test-unit` and `make test-integration` wrap these.

## Configuration

Every setting is a field on `Settings` in [`app/config.py`](app/config.py), read from the environment. The full reference is [`docs/configuration.md`](../../docs/configuration.md), and `scripts/check_docs_sync.py` fails CI if a setting is added without a doc entry.

## Notes

- **Whisper and pyannote are never in memory at the same time.** Whisper is explicitly unloaded (plus `gc.collect()`) before pyannote loads. This is mandatory on CPU-only hosts — see PRD-01 §5.4.
- **Diarization failure is non-fatal.** The transcript is still written with `speaker_label = NULL` and `has_diarization = false`.
- **The version here is packaging metadata.** The runtime version is read from the repo-root `VERSION` file by `app.main._read_version()`.

Design docs live in [`prds/`](../../prds); PRD-01 covers this app.
