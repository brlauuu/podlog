# Configuration

All configuration is via environment variables in `.env`. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

## Required Variables

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password. Choose something strong — this is used for the internal database. |
| `HF_TOKEN` | HuggingFace access token. Create one at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (read access is sufficient). You must also accept the [pyannote model license](https://huggingface.co/pyannote/speaker-diarization-3.1). |

## Pipeline Tuning

| Variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | Whisper model size. Options: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo`. Smaller models use less RAM but produce lower quality transcripts. |
| `WHISPER_COMPUTE_TYPE` | `int8` | Quantization type. `int8` is recommended for CPU (faster, lower RAM). Use `float32` for maximum accuracy. |
| `WHISPER_BATCH_SIZE` | `16` | WhisperX batched inference batch size. Reduce if you encounter OOM errors. |
| `ARCHIVE_AUDIO` | `true` | When `true`, audio is re-encoded to compressed MP3 after transcription and the raw download is deleted. Set `false` to delete audio entirely after processing (saves disk). |
| `AUDIO_ARCHIVE_BITRATE` | `64k` | MP3 bitrate for archived audio. `64k` is fine for speech; `128k` for higher quality. |
| `FEED_POLL_INTERVAL_HOURS` | `24` | How often the worker checks RSS feeds for new episodes. |
| `DATA_DIR` | `/data` | Base directory for audio files and transcripts inside the container. Normally no need to change this. |

## Retry and Error Handling

| Variable | Default | Description |
|---|---|---|
| `RETRY_MAX` | `3` | Maximum auto-retries for transient download failures. |
| `RETRY_BACKOFF_BASE` | `30` | Base backoff in seconds. Actual backoff = base x 2^(attempt-1), so: 30s, 60s, 120s. |
| `DISK_HEADROOM_BYTES` | `2147483648` | Minimum free disk space (in bytes) before the worker will start a new download. Default is 2 GB. |

## Zombie Job Detection

The worker monitors running jobs and marks them as failed if they exceed expected processing time. This catches jobs that stall due to OOM kills or other system issues.

| Variable | Default | Description |
|---|---|---|
| `ZOMBIE_REALTIME_FACTOR` | `1.5` | Expected processing speed relative to audio duration. A 1-hour episode with factor 1.5 is expected to take 1.5 hours. |
| `ZOMBIE_TIMEOUT_MULTIPLIER` | `2.0` | A job is marked zombie after running longer than `expected_time x multiplier`. With default settings, a 1-hour episode times out after 3 hours. |
| `ZOMBIE_MIN_TIMEOUT_MINUTES` | `60` | Minimum timeout floor in minutes. Prevents very short episodes from having unreasonably short timeouts. |

## Speaker Inference

| Variable | Default | Description |
|---|---|---|
| `INFERENCE_ENABLED` | `true` | Whether to run spaCy NER-based speaker name inference after diarization. |
| `SPACY_MODEL` | `en_core_web_lg` | spaCy model for named entity recognition. `en_core_web_lg` gives best results. |

## Fireworks Provider

| Variable | Default | Description |
|---|---|---|
| `INFERENCE_PROVIDER` | `local` | Runtime provider for transcription/diarization stages. `local` keeps current behavior. `fireworks` uses remote Fireworks audio inference. |
| `FIREWORKS_API_KEY` | (unset) | Required when `INFERENCE_PROVIDER=fireworks`. |
| `FIREWORKS_AUDIO_BASE_URL` | `https://audio-turbo.api.fireworks.ai` | Base URL for Fireworks audio API. |
| `FIREWORKS_STT_MODEL` | `whisper-v3-large` | Fireworks speech-to-text model ID. |
| `FIREWORKS_STT_DIARIZE` | `true` | Request speaker diarization metadata from Fireworks transcription API. |
| `FIREWORKS_CHAT_BASE_URL` | `https://api.fireworks.ai/inference/v1` | Base URL for Fireworks OpenAI-compatible chat completions used by Ask generation. |
| `FIREWORKS_CHAT_MODEL` | `accounts/fireworks/models/llama-v3p1-8b-instruct` | Fireworks chat model used when `INFERENCE_PROVIDER=fireworks` for Ask generation. |
| `FIREWORKS_STT_COST_PER_MINUTE_USD` | `0.006` | Cost estimate assumption used for per-episode observability (`estimated_cost_usd = billed_minutes * rate`). |
| `EMBEDDING_PROVIDER` | `local` | Runtime provider for query + segment/chunk embeddings (`local` or `fireworks`). |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Local sentence-transformers model used when `EMBEDDING_PROVIDER=local`. |
| `FIREWORKS_EMBEDDING_BASE_URL` | `https://api.fireworks.ai/inference/v1` | Base URL for Fireworks embeddings API. |
| `FIREWORKS_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | Fireworks embedding model used when `EMBEDDING_PROVIDER=fireworks`. |

### Deployment profiles

- Local-first profile (default): `docker compose up -d` or `make up`
  - Starts `db`, `pipeline`, `worker`, `web`, and `ollama`.
- Remote-inference profile: `docker compose -f docker-compose.yml -f docker-compose.remote.yml up -d` or `make up-remote`
  - Starts `db`, `pipeline`, `worker`, and `web`.
  - Applies `INFERENCE_PROVIDER=fireworks` and `EMBEDDING_PROVIDER=fireworks` to pipeline + worker.
  - Does not start `ollama` unless explicitly requested with profile `local-ask`.

Health behavior:
- In Fireworks mode, `/api/health` does not require live Ollama reachability for overall `OK` status.

### Fireworks retry policy

When Fireworks mode is enabled, Podlog applies automatic retries for transient transcription failures:

- Retryable: network/connect/timeouts, HTTP `429`, and HTTP `5xx`
- HTTP access errors: HTTP `4xx` map to `HTTP_ACCESS` and follow retry policy
- Backoff: `RETRY_BACKOFF_BASE * 2^(attempt-1)` (for example `30s`, `60s`, `120s` with defaults)
- Attempts: capped by `RETRY_MAX`

### Fireworks observability assumptions

- Per-episode Fireworks usage/cost is persisted on the episode row after successful remote transcription.
- Billed audio seconds are estimated from transcript segment end-times (fallback: episode duration).
- Cost is estimated (not reconciled billing): `fireworks_audio_minutes * FIREWORKS_STT_COST_PER_MINUTE_USD`.

### Embedding provider switching and backfill

- Existing vectors are not auto-migrated when switching embedding provider/model.
- If you switch embedding provider/model, run chunk/embedding backfill so query and stored vectors are generated by the same model family.
- If Fireworks embedding dimensions differ from Podlog's expected 384, embedding writes fail with a clear error.

## Health Monitoring

The host-level health check script (`scripts/healthcheck.py`) uses these settings. All are optional — defaults work for a standard Docker Compose setup.

| Variable | Default | Description |
|---|---|---|
| `HEALTH_CHECK_NOTIFICATIONS_ENABLED` | `true` | Enable/disable health-check Telegram notifications. Priority: `.env` value overrides DB/UI value. |
| `HEALTH_CHECK_PIPELINE_URL` | `http://localhost:8000` | Pipeline API URL as seen from the host. |
| `HEALTH_CHECK_WEB_URL` | `http://localhost:3000` | Web app URL as seen from the host. |
| `HEALTH_CHECK_DB_HOST` | `localhost` | PostgreSQL host for `pg_isready` and zombie job queries. |
| `HEALTH_CHECK_DB_PORT` | `5432` | PostgreSQL port. |
| `HEALTH_CHECK_DB_USER` | `postgres` | PostgreSQL user. |
| `HEALTH_CHECK_DB_NAME` | `podlog` | Database name. |
| `HEALTH_CHECK_ZOMBIE_THRESHOLD_MINUTES` | `60` | Minutes a `picked` job must be running before it's flagged as a zombie. |

The script uses `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `.env` if present; otherwise falls back to the values configured in the web UI. Requires `postgresql-client` (`pg_isready`, `psql`) on the host.

## Advanced / Internal

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (auto-generated) | PostgreSQL connection string. Override only if using an external database. |

## Model Memory Usage

| Whisper Model | Peak RAM | Recommended Machine RAM |
|---|---|---|
| `tiny` | ~1 GB | 4 GB |
| `base` | ~1 GB | 4 GB |
| `small` | ~2 GB | 8 GB |
| `medium` | ~5 GB | 12 GB |
| `large-v3` | ~10 GB | 16 GB |
| `large-v3-turbo` | ~6 GB | 12 GB |

pyannote diarization uses an additional ~2 GB during its phase, but Whisper is always unloaded before pyannote loads (they never coexist in memory).
