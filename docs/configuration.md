# Configuration

All configuration is via environment variables in `.env`. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

## Required Variables

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password. Choose something strong — this is used for the internal database. |
| `HF_TOKEN` | HuggingFace access token. Create one at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (read access is sufficient). You must also accept the [pyannote model license](https://huggingface.co/pyannote/speaker-diarization-community-1). |

## Pipeline Tuning

| Variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | Whisper model size. Options: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo`. Smaller models use less RAM but produce lower quality transcripts. |
| `WHISPER_COMPUTE_TYPE` | `int8` | Quantization type. `int8` is recommended for CPU (faster, lower RAM). Use `float32` for maximum accuracy. |
| `WHISPER_BATCH_SIZE` | `16` | WhisperX batched inference batch size. Reduce if you encounter OOM errors. |
| `PYANNOTE_MODEL` | `pyannote/speaker-diarization-community-1` | HuggingFace ID of the pyannote diarization model. Override to pin to `pyannote/speaker-diarization-3.1` or a newer release. Users must accept the license for whichever model is selected. |
| `ARCHIVE_AUDIO` | `true` | When `true`, audio is re-encoded to compressed MP3 after transcription and the raw download is deleted. Set `false` to delete audio entirely after processing (saves disk). |
| `AUDIO_ARCHIVE_BITRATE` | `64k` | MP3 bitrate for archived audio. `64k` is fine for speech; `128k` for higher quality. |
| `FEED_POLL_INTERVAL_HOURS` | `24` | How often the worker checks RSS feeds for new episodes. |
| `DATA_DIR` | `/data` | Base directory for audio files and transcripts inside the container. Normally no need to change this. |

### CPU threads

| Variable | Default | Description |
|---|---|---|
| `WHISPER_CPU_THREADS` | `0` | CPU threads for the WhisperX transcription pass. `0` auto-detects available cores. WhisperX otherwise defaults to 4, which pins transcription to 4 cores regardless of machine size. On hyperthreaded CPUs, set this to the physical-core count. |

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
| `SPACY_MODEL` | `en_core_web_trf` | spaCy NER model. `en_core_web_trf` (~500 MB, best accuracy) is the default; override to `en_core_web_lg` (~200 MB) on memory-constrained hosts. The worker image ships both and automatically falls back to `en_core_web_lg` at runtime if `trf` is unavailable. |
| `RECURRING_HOST_WINDOW` | `10` | How many recent episodes of a feed the `recurring_host` heuristic looks back over. |
| `RECURRING_HOST_THRESHOLD` | `0.8` | Fraction of that window a speaker must appear in to be treated as a recurring host (0.0–1.0). |
| `FEED_SPEAKER_CACHE_RECENCY_DAYS` | `365` | How long a user-supplied speaker rename stays eligible for reuse across episodes of the same feed. `0` disables the recency cutoff. |

## Fireworks Provider

| Variable | Default | Description |
|---|---|---|
| `INFERENCE_PROVIDER` | `local` | Runtime provider for transcription/diarization stages. `local` keeps current behavior. `fireworks` uses remote Fireworks audio inference. |
| `FIREWORKS_API_KEY` | (unset) | Required when `INFERENCE_PROVIDER=fireworks`. |
| `FIREWORKS_AUDIO_BASE_URL` | `https://audio-turbo.api.fireworks.ai` | Base URL for Fireworks audio API. |
| `FIREWORKS_STT_MODEL` | `whisper-v3-large` | Fireworks speech-to-text model ID. |
| `FIREWORKS_STT_DIARIZE` | `true` | Request speaker diarization metadata from Fireworks transcription API. |
| `FIREWORKS_CHAT_BASE_URL` | `https://api.fireworks.ai/inference/v1` | Base URL for Fireworks OpenAI-compatible chat completions used by Ask generation. |
| `FIREWORKS_CHAT_MODEL` | `accounts/fireworks/models/gpt-oss-20b` | Fireworks chat model used when `RAG_PROVIDER=fireworks` for Ask generation. The Settings UI exposes a curated dropdown of currently-deployed models; this env var supplies the default. |
| `RAG_PROVIDER` | `local` | Issue #608: dedicated provider for the Ask / RAG step. Decoupled from `INFERENCE_PROVIDER` (transcription) so enabling Fireworks for transcription does not silently send retrieved transcript chunks to Fireworks for answer generation. Set to `fireworks` to opt in. |
| `FIREWORKS_STT_COST_PER_MINUTE_USD` | `0.006` | Cost estimate assumption used for per-episode observability (`estimated_cost_usd = billed_minutes * rate`). |
| `EMBEDDING_PROVIDER` | `local` | Runtime provider for query + segment/chunk embeddings. **`fireworks` is non-functional** — see the note below. |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Local sentence-transformers model used when `EMBEDDING_PROVIDER=local`. Must match the model your existing embeddings were built with — see the warning below. |
| `FIREWORKS_EMBEDDING_BASE_URL` | `https://api.fireworks.ai/inference/v1` | Base URL for Fireworks embeddings API. Retained for when/if Fireworks restores the endpoint. |
| `FIREWORKS_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | Fireworks embedding model. Currently unreachable — the model was retired upstream. |

> **Remote embedding is unavailable (issue #944).** Fireworks retired its
> serverless embeddings API: every model on `/inference/v1/embeddings` returns
> `503 no healthy upstream`, including model names that do not exist, so the
> request never reaches model resolution. The only embedding model Fireworks
> still serves is 4096-dimensional, and the `segments.embedding` column is
> `vector(384)`, so it is not a drop-in replacement. Embeddings run locally
> even under the remote-inference profile; the model is small and CPU-only, so
> this costs little. The setting is still accepted so existing configurations
> do not fail validation, but selecting it will fail every embed job.

> **Changing `EMBEDDING_MODEL` on an existing install is blocked (issue #945).**
> `all-MiniLM-L6-v2` and `BAAI/bge-small-en-v1.5` are both 384-dimensional but
> live in different vector spaces, so the dimension check passes, the write
> succeeds, and nothing warns — while similarity between old and new rows
> becomes meaningless. The model that produced the corpus is now recorded on
> first embed, and a later mismatch is refused rather than written. If your
> embeddings were previously generated through Fireworks, set
> `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5` to keep using them; running that
> model locally reproduces the same vectors exactly. Changing the model
> deliberately means re-embedding the corpus.

#### Inspecting and verifying embedding provenance

| Endpoint | Purpose |
|---|---|
| `GET /api/embed/model-state` | Which model built the corpus, which is configured, whether they agree, and how many segments are embedded. Also shown under the Embedding card in Settings. |
| `POST /api/embed/verify` | Re-embeds a sample of stored segments with the configured model and reports the mean cosine against their stored vectors. `1.0` means the configured model reproduces the corpus; a low value (~0.3) means a different vector space. |

The record is a claim about the past; `verify` is the only thing that checks it
against reality. Run it after any deliberate model change, and if you are ever
unsure which model built an existing corpus — that is exactly how it was
identified when this was first diagnosed.

Behaviour on mismatch: writes (the `embed` pipeline stage, chunk backfill) fail
with an explanatory error, and query embedding returns non-200, which the web
app degrades into keyword-only search rather than returning meaningless
semantic results.

## pyannote Cloud Provider (Issue #516)

Paid hosted diarization from pyannote.ai. Optional; the default is the free local `community-1` model. See the full [pyannote Cloud guide](guide/13-pyannote-cloud.md) for setup and billing details.

| Variable | Default | Description |
|---|---|---|
| `DIARIZATION_PROVIDER` | `local` | `local` uses the free local pyannote model; `precision2` routes diarization to pyannote.ai's cloud API. |
| `PYANNOTE_API_KEY` | (unset) | Required when `DIARIZATION_PROVIDER=precision2`. Generate at [dashboard.pyannote.ai](https://dashboard.pyannote.ai). |
| `PYANNOTE_CLOUD_BASE_URL` | `https://api.pyannote.ai/v1` | Base URL for the pyannote.ai REST API. |
| `PYANNOTE_CLOUD_MODEL` | `precision-2` | Cloud model name sent on each request. `precision-2` or `community-1`. |
| `PYANNOTE_CLOUD_COST_PER_SECOND_USD` | `0.0` | Your per-second rate (check your pyannote.ai dashboard). Leave at `0.0` to skip cost estimates — diarization still runs, but `pyannote_cloud_cost_usd` will be `0` and the episode cost chip shows `$—`. Billed seconds have a 20-second per-request minimum. |

`INFERENCE_PROVIDER=fireworks` takes precedence — Fireworks transcription returns diarization metadata inline, so `DIARIZATION_PROVIDER` is ignored when Fireworks is enabled.

### Ask / RAG Model Selection

Ask AI uses the model selected in the `/ask` page UI and sends it with each request. There is no `OLLAMA_MODEL` environment variable in Podlog.

- For local Ask mode, `OLLAMA_URL` controls the Ollama endpoint that serves the selected model.
- The Ask page and per-episode chat popup default to `qwen2.5:3b` unless you choose another option. The full list is `qwen2.5:3b`, `phi3:mini`, and `gemma3n:e4b` — all pulled by `make ollama-pull`.
- Each model runs with a bounded `num_ctx` (8K–16K) to keep CPU prefill fast. The dropdown shows both the configured value and the model's maximum context.
- When `RAG_PROVIDER=fireworks`, `FIREWORKS_CHAT_MODEL` provides the default Ask model for remote generation. The Ask page renders a curated dropdown of currently-deployed Fireworks chat models; the configured value is used as the default selection. (Note: this is independent of `INFERENCE_PROVIDER` — see Issue #608.)

### Deployment profiles

- Local-first profile (default): `docker compose up -d` or `make up`
  - Starts `db`, `pipeline`, `worker`, `web`, and `ollama`.
- Remote-inference profile: `docker compose -f docker-compose.yml -f docker-compose.remote.yml up -d` or `make up-remote`
  - Starts `db`, `pipeline`, `worker`, and `web`.
  - Applies `INFERENCE_PROVIDER=fireworks` to pipeline + worker. It deliberately does **not** set `EMBEDDING_PROVIDER`: remote embedding is unavailable (see above), so embeddings run locally even in this profile.
  - Does not start `ollama` unless explicitly requested with profile `local-ask`.

Health behavior:
- In Fireworks mode, `/api/health` does not require live Ollama reachability for overall `OK` status.

### Fireworks retry policy

When Fireworks mode is enabled, Podlog applies automatic retries for transient transcription failures:

- Retryable: network/connect/timeouts, HTTP `429`, and HTTP `5xx`
- HTTP access errors: HTTP `4xx` from Fireworks map to `HTTP_ACCESS` and are retried, because Fireworks returns 4xx for conditions that clear. This differs from a 4xx on a podcast audio URL, which is terminal.
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

## Notifications

Delivery settings for pipeline notifications. Telegram credentials are shared with the health-check script above. Most of these can also be set from the web UI (Settings → Notifications); the `.env` value wins where both are present.

| Variable | Default | Description |
|---|---|---|
| `NOTIFICATION_FREQUENCY` | `immediate` | When to deliver. One of `immediate`, `daily`, `weekly`. The digest modes batch events instead of sending per-episode. |
| `NOTIFICATION_EMAIL_TO` | (unset) | Recipient address for email notifications. Email delivery is off unless this is set. |
| `NOTIFICATION_EMAIL_FROM` | `podlog@localhost` | From address on outgoing notification email. |

### SMTP

Only used when `NOTIFICATION_EMAIL_TO` is set.

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | `host.docker.internal` | SMTP server hostname. The default targets an MTA running on the Docker host. |
| `SMTP_PORT` | `25` | SMTP port. Use `587` for STARTTLS submission. |
| `SMTP_USER` | (unset) | SMTP username. Leave unset for an unauthenticated relay. |
| `SMTP_PASSWORD` | (unset) | SMTP password. |
| `SMTP_USE_TLS` | `false` | Use STARTTLS. Set alongside `SMTP_PORT=587` for most hosted providers. |

## Backups

The `backup` service runs by default (see [Backups](guide/16-backups.md) for restore procedures). Set all three retention values to `0` to opt out entirely.

| Variable | Default | Description |
|---|---|---|
| `BACKUP_RETENTION_DAILY` | `7` | Daily DB dumps to keep. `0` disables the daily bucket. |
| `BACKUP_RETENTION_WEEKLY` | `4` | Weekly dumps to keep. |
| `BACKUP_RETENTION_MONTHLY` | `12` | Monthly dumps to keep. |
| `BACKUP_CHECK_INTERVAL_SECS` | `3600` | How often the backup loop wakes to check whether today's backup has run. |

## Ask AI Prompts

System prompts sent to the LLM at the start of each chat. These are the build-time defaults; overrides saved from Settings → Prompts live in the database and take precedence. "Reset to default" in the UI clears the override and falls back to the value here.

| Variable | Default | Description |
|---|---|---|
| `PROMPT_ASK_PAGE_SYSTEM` | (built-in) | System prompt for the cross-episode `/ask` page. |
| `PROMPT_ASK_EPISODE_SYSTEM` | (built-in) | System prompt for the per-episode Ask popup. |
| `RAG_LOCAL_MODEL` | `qwen2.5:3b` | Default Ollama model for local RAG generation. The Ask UI can override this per request. |

## Advanced / Internal

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (auto-generated) | PostgreSQL connection string. Override only if using an external database. |
| `HARDWARE_PROFILE` | (auto-detected) | Pins the hardware profile used for tuning defaults instead of detecting it at startup. Leave unset unless detection is getting it wrong. |

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
