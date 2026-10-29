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

## Pipeline Alerts

The worker checks every 15 minutes for a pipeline that keeps failing or has stopped moving, and sends one alert through your notification channels, then one more when it recovers. Alerts go out immediately, even when you chose a daily or weekly digest. See [Notifications](guide/09-notifications.md#pipeline-alerts).

| Variable | Default | Description |
|---|---|---|
| `PIPELINE_ALERT_FAILURE_STREAK` | `5` | Alert when one stage has failed this many jobs in a row since its last success. Each retry is its own job, so one episode retried 3 times counts 4. `0` turns the check off. |
| `PIPELINE_ALERT_STALL_HOURS` | `24` | Alert when jobs have waited longer than this and no job has finished in that time. An empty queue never alerts. `0` turns the check off. |

## Speaker Inference

| Variable | Default | Description |
|---|---|---|
| `INFERENCE_ENABLED` | `true` | Whether to run spaCy NER-based speaker name inference after diarization. |
| `SPACY_MODEL` | `en_core_web_trf` | spaCy NER model. `en_core_web_trf` (~500 MB, best accuracy) is the default; override to `en_core_web_lg` (~200 MB) on memory-constrained hosts. The worker image ships both and automatically falls back to `en_core_web_lg` at runtime if `trf` is unavailable. |
| `RECURRING_HOST_WINDOW` | `10` | How many recent episodes of a feed the `recurring_host` heuristic looks back over. |
| `RECURRING_HOST_THRESHOLD` | `0.8` | Fraction of that window a speaker must appear in to be treated as a recurring host (0.0–1.0). |
| `FEED_SPEAKER_CACHE_RECENCY_DAYS` | `365` | How long a user-supplied speaker rename stays eligible for reuse across episodes of the same feed. `0` disables the recency cutoff. |

## Embedding Model

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Local sentence-transformers model for query and segment/chunk embeddings. Restricted to two tested values, `all-MiniLM-L6-v2` and `BAAI/bge-small-en-v1.5` — the field used to be free text and was passed straight to the model loader, which downloads whatever HuggingFace repo you name (#951). Editable at runtime under **Settings → Inference**. Must match the model your existing embeddings were built with — see the warning below. |

> **Changing `EMBEDDING_MODEL` on an existing install is blocked (issue #945).**
> `all-MiniLM-L6-v2` and `BAAI/bge-small-en-v1.5` are both 384-dimensional but
> live in different vector spaces, so the dimension check passes, the write
> succeeds, and nothing warns — while similarity between old and new rows
> becomes meaningless. The model that produced the corpus is now recorded on
> first embed, and a later mismatch is refused rather than written. An
> install whose embeddings came from the retired Fireworks path was built with
> `BAAI/bge-small-en-v1.5`; on startup Podlog pins that model when you never
> chose one, and running it locally reproduces the same vectors exactly.
> Changing the model deliberately means re-embedding the corpus.

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

## Removed: remote inference (#1092)

Podlog used to offer Fireworks AI (transcription, Ask generation, embeddings)
and pyannote.ai (diarization) as paid remote alternatives. Both were removed;
every stage now runs on your own machine. These variables no longer do
anything:

`INFERENCE_PROVIDER`, `DIARIZATION_PROVIDER`, `RAG_PROVIDER`,
`EMBEDDING_PROVIDER`, `FIREWORKS_API_KEY`, `FIREWORKS_AUDIO_BASE_URL`,
`FIREWORKS_STT_MODEL`, `FIREWORKS_STT_DIARIZE`, `FIREWORKS_CHAT_BASE_URL`,
`FIREWORKS_CHAT_MODEL`, `FIREWORKS_STT_COST_PER_MINUTE_USD`,
`FIREWORKS_EMBEDDING_BASE_URL`, `FIREWORKS_EMBEDDING_MODEL`,
`PYANNOTE_API_KEY`, `PYANNOTE_CLOUD_BASE_URL`, `PYANNOTE_CLOUD_MODEL`,
`PYANNOTE_CLOUD_COST_PER_SECOND_USD`.

If any are still in your `.env`, the worker and pipeline log one warning naming
them at startup; delete them (`make env-diff` lists them too). Settings stored
from the old Settings UI, API keys included, are deleted automatically on the
first start after upgrading. Nothing else needs doing.

### Ask / RAG Model Selection

Ask AI uses the model selected in the `/ask` page UI and sends it with each request. There is no `OLLAMA_MODEL` environment variable in Podlog.

- For local Ask mode, `OLLAMA_URL` controls the Ollama endpoint that serves the selected model.
- The Ask page and per-episode chat popup default to `qwen2.5:3b` unless you choose another option. The full list is `qwen2.5:3b`, `phi3:mini`, and `gemma3n:e4b` — all pulled by `make ollama-pull`.
- Each model runs with a bounded `num_ctx` (8K–16K) to keep CPU prefill fast. The dropdown shows both the configured value and the model's maximum context.

### Starting the stack

`docker compose up -d` or `make up` starts `db`, `pipeline`, `worker`, `web`,
`ollama` and `backup` — six services. `/api/health` reports `OK` only when
Ollama is reachable, since Ask depends on it.

### Embedding model switching and backfill

- Existing vectors are not auto-migrated when switching embedding model.
- If you switch embedding model, run chunk/embedding backfill so query and stored vectors are generated by the same model.

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
| `TELEGRAM_BOT_TOKEN` | (unset) | Bot token from @BotFather. Telegram delivery is off unless this and `TELEGRAM_CHAT_ID` are set. |
| `TELEGRAM_CHAT_ID` | (unset) | Chat that receives done/failed notifications and health alerts. |
| `WEB_INTERNAL_URL` | `http://web:3000` | Where the pipeline reaches the web app for the bot's `/search`. Only change it when running the pipeline natively outside compose. |
| `PODLOG_LAN_URL` | (computed by `make up`) | The LAN address the bot uses to link search hits to episode pages, and the one it replies with to `/address`. Not a `.env` setting: `make up` detects it and passes it to the `web` and `pipeline` containers. Empty means the bot sends no links and `/address` reports that none is recorded. |
| `TELEGRAM_ALLOWED_USER_IDS` | (unset) | Comma-separated numeric Telegram user IDs allowed to send the bot commands. An account not listed here gets a refusal to everything except `/whoami`. Empty means the bot never reads messages. See the [notifications guide](guide/09-notifications.md#telegram-bot-commands). |

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

## Releases and updating

Used by `make up-release` and `make update` — see [Updating](guide/20-updating.md).
None of these are read by the pipeline; they are consumed by the Makefile and
the web footer.

| Variable | Default | Description |
|---|---|---|
| `PODLOG_VERSION` | `stable` | Which published image `make up-release` starts: `stable`, `edge`, or an exact `X.Y.Z`. Ignored by `make build`, which builds from source and tags the result with this value. |
| `PODLOG_CHANNEL` | `stable` | What `make update` follows when no `VERSION=` is passed: `stable` (newest release tag) or `edge` (current `main`, rebuilt from source). |
| `PODLOG_LAN_URL` | *(set by `make up`)* | The address to show under **Settings → Access from another device**. `make up` computes it on the host and passes it in; the container cannot work it out, since it sees only its Docker bridge address. With a bare `docker compose up` it is empty and the app falls back to whatever address your browser used. |
| `UPDATE_CHECK_ENABLED` | `false` | Check GitHub for a newer release and show a link in the footer. Off by default — it is an outbound call. The host makes it, roughly every six hours, cached in between. It never installs anything. |

Published images are `linux/amd64` only; build from source on other
architectures.

## Ask AI Prompts

System prompts sent to the LLM at the start of each chat. These are the build-time defaults; overrides saved from Settings → Prompts live in the database and take precedence. "Reset to default" in the UI clears the override and falls back to the value here.

| Variable | Default | Description |
|---|---|---|
| `PROMPT_ASK_PAGE_SYSTEM` | (built-in) | System prompt for the cross-episode `/ask` page. |
| `PROMPT_ASK_EPISODE_SYSTEM` | (built-in) | System prompt for the per-episode Ask popup. |
| `RAG_LOCAL_MODEL` | `qwen2.5:3b` | Default Ollama model for local RAG generation. The Ask UI can override this per request. |

## Search: query-embedding resilience

Read by the **web** app, not the pipeline. Hybrid search asks the pipeline for a query embedding; if that call fails or times out, search degrades to keyword-only rather than erroring, because keyword search reads Postgres directly and never needed the pipeline.

| Variable | Default | Description |
|---|---|---|
| `EMBED_TIMEOUT_MS` | `2000` | Bounds the query-embedding call. Without a bound, an unresolvable `pipeline` host sits in DNS retry for ~24s — long enough for requests to pile up and exhaust the connection pool behind them (#928). |
| `EMBED_COOLDOWN_MS` | `30000` | After a failure, skip the call entirely for this long, so a down pipeline does not make every request pay the timeout. |

The pipeline lazy-loads the embedding model on the first `/api/embed` call, so the first search after a pipeline restart usually exceeds the 2s default and returns keyword-only results for one cooldown window. It self-heals; raise `EMBED_TIMEOUT_MS` if you would rather pay the cold start.

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
