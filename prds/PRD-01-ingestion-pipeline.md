# PRD-01: Podcast Ingestion Pipeline

**Project:** Podlog — Self-hosted Podcast Transcription & Search  
**Document:** PRD-01 — Ingestion Pipeline  
**Version:** 1.5
**Status:** Active
**Author:** Claude (generated from user specification)
**Changelog:**
- v1.5 — §5.2 retry copy corrected to match code: backoff formula is `RETRY_BACKOFF_BASE * 2^(attempt-1)` (30s → 60s → 120s), and HTTP 4xx is clarified as classified `HTTP_ACCESS` with retry (not "non-transient and retried").
- v1.4 — Added optional remote inference provider mode (Fireworks) for transcription and diarization while keeping local-first defaults. Runtime provider settings can be sourced from DB-backed Settings UI (env fallback remains). Added Fireworks configuration vars.
- v1.3 — Updated tech stack to reflect actual implementation: Celery+Redis replaced by PostgreSQL-backed job queue; Whisper via transformers replaced by WhisperX (CTranslate2); Celery Beat replaced by polling loop in worker.py; Flower removed. Added Ollama for RAG inference. Updated architecture diagram. Removed stale env vars (REDIS_URL, CELERY_CONCURRENCY). Moved semantic search and faster Whisper from Future to Done. Updated default model to large-v3-turbo.
- v1.2 — Renamed project from PodSearch to Podlog. Added `updated_at` field to episodes table (prerequisite for GAP-01 zombie job detection). Added `DISK_HEADROOM_BYTES` environment variable for disk space pre-check (GAP-06). Database name changed from `podsearch` to `podlog`.
- v1.1 — Added auto-retry logic (OQ-02 resolved), disk-full handling (OQ-03 resolved), diarization failure persistence (OQ-04 resolved), model pre-warm step, memory sequencing requirement for Whisper+pyannote, pipeline container healthcheck, path traversal mitigation for audio serving.

---

## 1. Problem Statement

Podcast listeners who want to search, reference, or revisit specific moments in long-form audio have no reliable way to do so. Published transcripts are rare, inaccurate, or not searchable. This pipeline solves the upstream half of the problem: automatically fetching podcast episodes from RSS feeds, transcribing them with a state-of-the-art speech-to-text model, labeling speakers, and storing timestamped transcripts in a queryable database — local-first by default, with optional remote inference provider support.

---

## 2. Goals & Non-Goals

### Goals
- Ingest podcast episodes from RSS feeds automatically and on-demand
- Transcribe audio using an open-weight Whisper model (CPU-compatible)
- Perform speaker diarization (Speaker 1 / Speaker 2 labeling)
- Store transcripts with word-level timestamps in a searchable database
- Archive compressed audio files locally as backup
- Provide visibility into queue progress and errors
- Run entirely in Docker in local-first mode; allow optional remote inference provider configuration

### Non-Goals (for this PRD)
- Named speaker identification (deferred to post-MVP UI feature)
- Authentication or remote access (covered in PRD-02)
- Public API surface (internal only)

---

## 3. Users & Context

**Primary user:** A single developer/enthusiast running this on their own machine. Technical enough to run Docker and set environment variables, but the day-to-day experience should require no command-line interaction once set up.

**Usage pattern:** Set-and-forget. The user adds RSS feeds and lets the system run. They may check the queue dashboard occasionally to monitor progress or investigate errors.

---

## 4. User Stories

| ID    | Story                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-01 | As a user, I can add a podcast RSS feed URL so that its episodes are queued for processing.                                                                           |
| US-02 | As a user, I can trigger processing of a single episode manually by pasting a direct audio URL.                                                                       |
| US-03 | As a user, I can view the full queue — pending, in-progress, completed, and failed jobs — so I know what the system is working on.                                    |
| US-04 | As a user, I can see a live progress indicator for the currently processing episode (download %, transcription %).                                                    |
| US-05 | As a user, I can retry a failed job with one click.                                                                                                                   |
| US-06 | As a user, I can see the error message for any failed job so I understand what went wrong.                                                                            |
| US-07 | As a user, new episodes from monitored feeds are automatically detected every 24 hours and added to the queue without any action on my part.                          |
| US-08 | As a user, already-processed episodes are never re-processed (idempotent ingestion).                                                                                  |
| US-09 | As a user, audio files are archived in compressed format after transcription to save disk space.                                                                      |
| US-10 | As a user, I can see when an episode's transcript was produced without speaker labels due to a diarization failure, both in the episode list and on the episode page. |

---

## 5. Functional Requirements

### 5.1 RSS Feed Management

- The system accepts a podcast RSS 2.0 / Atom feed URL as input.
- On first addition, all existing episodes in the feed are enumerated and added to the processing queue.
- The system stores: feed URL, feed title, feed description, feed image URL, date last polled.
- A background scheduler polls all registered feeds every 24 hours and enqueues any episodes not already present in the database.
- Duplicate detection is based on the episode's `<guid>` element from RSS, falling back to the audio file URL if no GUID is present.

### 5.2 Episode Download

- Audio is downloaded from the URL specified in the RSS `<enclosure>` tag.
- Download progress is tracked and surfaced to the queue dashboard.
- Files are saved to a configurable local volume path: `/data/audio/raw/`.
- Supported formats: MP3, M4A, AAC, OGG, FLAC, WAV. Any format `ffmpeg` can decode is acceptable.
- **Failure handling:** If a download fails due to a transient access error (network timeout, HTTP 5xx classified as `TRANSIENT_NETWORK`), the job is automatically retried up to 3 times with exponential backoff (`RETRY_BACKOFF_BASE * 2^(attempt-1)` — with the default base of 30s, the delays are 30s → 60s → 120s) before being marked permanently failed. HTTP 4xx errors (e.g. 403, 404) are classified as `HTTP_ACCESS` and are also retried up to 3 times with the same backoff, since feeds and CDNs sometimes return temporary 4xx responses. OOM errors, disk full errors, and local system failures are **not** retried — they are marked failed immediately with a clear error classification (see §5.9).
- The retry count and last error are stored per episode and surfaced in the queue dashboard (see PRD-02 §5.6).

### 5.3 Audio Preprocessing

- After download, audio is converted to 16kHz mono WAV using `ffmpeg` before passing to Whisper (this is the format Whisper expects).
- The intermediate WAV file is temporary and deleted after transcription.

### 5.4 Transcription (Speech-to-Text)

- Provider modes:
  - `local` (default): WhisperX with CTranslate2 backend + wav2vec2 word-level alignment, optimized for CPU inference.
  - `fireworks` (optional): Fireworks `/v1/audio/transcriptions` API with `verbose_json` response.
- Default model: `large-v3-turbo` (configurable via `WHISPER_MODEL` env var: tiny|base|small|medium|large-v3|large-v3-turbo).
- The model is downloaded once and cached in a persistent Docker volume.
- **Memory management:** Whisper is loaded into memory for transcription and **explicitly unloaded** (removed from memory and `gc.collect()` called) before pyannote is loaded for diarization. The two models must never be resident in memory simultaneously. This is mandatory on CPU-only machines to avoid OOM.
- Transcription produces: text segments, each with `start_time` (seconds), `end_time` (seconds), and `text`.
- Word-level timestamps are produced via WhisperX's wav2vec2 alignment step.
- Language detection is automatic; detected language is stored per episode.
- Transcription progress (segment count / estimated total) is surfaced to the queue.

### 5.5 Speaker Diarization

- Local mode library: `pyannote/community-1` from HuggingFace (configurable via `PYANNOTE_MODEL`).
- Requires a HuggingFace access token set via environment variable `HF_TOKEN` for local mode. The user must accept the pyannote model license on HuggingFace.com independently.
- Fireworks mode uses diarization metadata returned by Fireworks transcription responses when enabled.
- Diarization produces speaker-labeled time segments: `{ speaker: "SPEAKER_00", start: 12.4, end: 18.1 }`.
- **Alignment strategy:** Transcript segments and diarization segments are aligned by majority overlap. For each transcript segment, the speaker whose time range overlaps the most with that segment's duration is assigned as the speaker label. In the event of an exact tie, the speaker label from the earlier-starting segment is used.
- Speaker labels are stored as `SPEAKER_00`, `SPEAKER_01`, etc. Renaming to human names is handled in the web UI (PRD-02).
- **Diarization failure handling:** If diarization fails for any reason, the transcript segments are still written to the database with `speaker_label = NULL`. The episode is marked `done` but with `has_diarization = false` and a `diarization_error` field populated with the failure reason. This state is visible in the database and surfaced in the UI at three locations: the episode list badge, the episode transcript page header, and inline on search result cards (see PRD-02 §5.4, §5.1).

### 5.6 Punctuation & Formatting

- Whisper large-v3 produces punctuated output natively — no additional punctuation model is needed.
- Transcript segments are stored as-is from Whisper. No post-processing normalization is applied in V1.

### 5.7 Data Storage

**Relational database (PostgreSQL):**

Stores all structured metadata and transcript segments. Schema described in Section 7.

**Flat file archive (optional, parallel):**

After processing, a plain `.txt` transcript file is written to `/data/transcripts/` with the format:
```
[00:01:23 - 00:01:45] SPEAKER_00: This is what was said here.
[00:01:45 - 00:02:10] SPEAKER_01: And here is the response.
```
If diarization failed, speaker labels are omitted:
```
[00:01:23 - 00:01:45] This is what was said here.
[00:01:45 - 00:02:10] And here is the response.
```
The flat file is always written on successful transcription, regardless of diarization outcome. A header comment notes the diarization status:
```
# Podlog Transcript
# Episode: <title>
# Diarization: FAILED (<reason>)
```

### 5.8 Audio Archival

- After successful transcription, the original downloaded audio file is compressed to MP3 at 64 kbps using `ffmpeg` and moved to `/data/audio/archive/`.
- The original file is deleted after successful compression.
- The archived file path is stored in the database.
- **Disk full handling:** If a disk-full condition (`OSError: [Errno 28] No space left on device` or equivalent) is detected during archival, the job is marked `failed` with error classification `DISK_FULL`. The raw audio file is **not** deleted. No retry is attempted — disk full is a local system condition the user must resolve manually. The queue dashboard displays a distinct "Disk full" error state with a message directing the user to free space and then manually retry.
- If `ARCHIVE_AUDIO=false` is set in environment config, audio files are deleted after transcription with no archival.

### 5.9 Task Queue & Error Classification

- Task runner: **PostgreSQL-backed job queue** (no external broker). Jobs are stored in the `episodes` table with status tracking.
- Jobs are processed sequentially by default (one worker, concurrency=1) to avoid memory exhaustion on CPU-only machines running Whisper.
- Job states: `PENDING` → `DOWNLOADING` → `TRANSCRIBING` → `DIARIZING` → `EMBEDDING` → `CHUNKING` → `INFERRING` → `ARCHIVING` → `DONE` / `FAILED`.
- **Error classification:** All failures are tagged with an `error_class` field stored in the database and surfaced in the queue UI:

| `error_class`        | Meaning                               | Auto-retry?              |
| -------------------- | ------------------------------------- | ------------------------ |
| `TRANSIENT_NETWORK`  | Timeout, connection reset             | Yes, up to 3x            |
| `HTTP_ACCESS`        | HTTP 4xx/5xx from audio host          | Yes, up to 3x            |
| `DISK_FULL`          | No space left on device               | No                       |
| `OOM`                | Out of memory (Whisper/pyannote)      | No                       |
| `DIARIZATION_FAILED` | pyannote error (transcript preserved) | No — episode marked done |
| `SYSTEM_ERROR`       | Unexpected exception                  | No                       |

- When a job is in retry state, the queue dashboard shows: `"Retrying (2/3) — HTTP 403"` with the next scheduled retry time.
- Failed jobs retain their full error traceback in the database.

### 5.10 Scheduler

- A polling loop in `worker.py` runs every `FEED_POLL_INTERVAL_HOURS` (default: 24) to poll all registered feeds for new episodes.
- No external scheduler dependency — the worker process handles both job processing and periodic polling.

### 5.11 Model Pre-Warm

- On worker container startup, before accepting any jobs, the worker runs a model pre-warm step that downloads and loads both Whisper and pyannote weights into the model cache volume.
- During pre-warm, the worker reports a `WARMING_UP` health state to the FastAPI health endpoint (`GET /api/health`).
- Jobs submitted during warm-up are queued normally but not processed until warm-up completes.
- The web UI queue dashboard displays a "Worker initializing — downloading models" banner when the health endpoint returns `WARMING_UP`. This resolves the silent wait that would otherwise occur on first run (~3GB download).
- Pre-warm is skipped if both model directories are already present in the cache volume.

---

## 6. Non-Functional Requirements

| Concern       | Requirement                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance   | No GPU required. A 1-hour episode may take 30–90 minutes on CPU. This is acceptable.                                                                |
| Reliability   | Failed jobs must not block the queue. Errors must be classified, logged, and surfaced.                                                              |
| Disk space    | Compressed audio archive uses ~30 MB/hour. User is responsible for disk management.                                                                 |
| Portability   | All services run in Docker. No host dependencies beyond Docker and Docker Compose.                                                                  |
| Open source   | All code is O'Saasy licensed. pyannote model requires user to accept its own license separately. HF_TOKEN is required and is the user's responsibility. |
| Idempotency   | Re-running ingestion on an already-processed episode is a no-op.                                                                                    |
| Observability | All pipeline steps log structured JSON to stdout, captured by Docker. Error class is always included in log output.                                 |
| Memory safety | Whisper and pyannote models must never be loaded simultaneously. Explicit unload + GC between stages is mandatory.                                  |

---

## 7. Data Model

```sql
-- Podcast feeds
CREATE TABLE feeds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url             TEXT NOT NULL UNIQUE,
    title           TEXT,
    description     TEXT,
    image_url       TEXT,
    website_url     TEXT,
    last_polled_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Individual episodes
CREATE TABLE episodes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_id             UUID REFERENCES feeds(id) ON DELETE CASCADE,
    guid                TEXT NOT NULL,
    title               TEXT,
    description         TEXT,
    published_at        TIMESTAMPTZ,
    duration_secs       INTEGER,
    audio_url           TEXT NOT NULL,
    audio_local_path    TEXT,
    transcript_path     TEXT,
    language            TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    error_message       TEXT,
    error_class         TEXT,          -- TRANSIENT_NETWORK | HTTP_ACCESS | DISK_FULL | OOM | SYSTEM_ERROR
    retry_count         INTEGER NOT NULL DEFAULT 0,
    retry_max           INTEGER NOT NULL DEFAULT 3,
    has_diarization     BOOLEAN DEFAULT false,
    diarization_error   TEXT,          -- populated if diarization failed; null if succeeded or not yet attempted
    job_picked_at       TIMESTAMPTZ,   -- when the worker started processing
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),  -- updated on every status change; used for zombie job detection (GAP-01)
    processed_at        TIMESTAMPTZ,
    UNIQUE(feed_id, guid)
);

-- Transcript segments (the core searchable content)
CREATE TABLE segments (
    id              BIGSERIAL PRIMARY KEY,
    episode_id      UUID REFERENCES episodes(id) ON DELETE CASCADE,
    speaker_label   TEXT,              -- SPEAKER_00, SPEAKER_01, or NULL (diarization unavailable)
    start_time      REAL NOT NULL,
    end_time        REAL NOT NULL,
    text            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Full-text search index
CREATE INDEX segments_text_fts ON segments USING GIN(to_tsvector('english', text));
CREATE INDEX segments_episode_id ON segments(episode_id);
CREATE INDEX segments_start_time ON segments(start_time);

-- Speaker label customization (user renames SPEAKER_00 to "Alice")
CREATE TABLE speaker_names (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id      UUID REFERENCES episodes(id) ON DELETE CASCADE,
    speaker_label   TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    UNIQUE(episode_id, speaker_label)
);
```

**New fields vs v1.0:** `error_class`, `retry_count`, `retry_max`, `diarization_error` added to `episodes`.
**New fields vs v1.1:** `updated_at` added to `episodes` (auto-set on every status change; enables zombie job detection per GAP-01).

---

## 8. Tech Stack

| Component        | Choice                                       | Rationale                                    |
| ---------------- | -------------------------------------------- | -------------------------------------------- |
| Language         | Python 3.11                                  | Best ecosystem for ML/audio tooling          |
| STT              | WhisperX (CTranslate2 + wav2vec2 alignment)  | Faster CPU inference; word-level timestamps  |
| Diarization      | `pyannote/community-1`                       | Industry standard; HuggingFace native        |
| Audio processing | `ffmpeg` (via `ffmpeg-python`)               | Universal format support                     |
| Task queue       | PostgreSQL-backed job queue                   | No external broker needed; jobs in episodes table |
| LLM inference    | Ollama (local)                               | RAG-based Ask AI feature; configurable model |
| Database         | PostgreSQL 15 (pgvector)                     | Full-text search + vector embeddings; ACID   |
| ORM              | SQLAlchemy 2.0 + Alembic                     | Migrations, async support                    |
| Containerization | Docker + Docker Compose                      | Single `docker compose up` experience        |
| Config           | `pydantic-settings`                          | Type-safe env var parsing                    |

---

## 9. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                         │
│                  ┌──────────┐    ┌──────────────────┐  │
│                  │  Worker  │───►│   PostgreSQL 15   │  │
│                  │          │    │   (pgvector)      │  │
│                  │ pre-warm │    │   transcripts,    │  │
│                  │ download │    │   metadata,       │  │
│                  │ whisperx │    │   job queue       │  │
│                  │ [unload] │    └──────────────────┘  │
│                  │ pyannote │                           │
│                  │ ffmpeg   │    ┌──────────────────┐  │
│                  │ polling  │───►│  /data volume    │  │
│                  └──────────┘    │  audio/archive/  │  │
│                                  │  transcripts/    │  │
│  ┌──────────┐                    │  models/         │  │
│  │  Ollama  │                    └──────────────────┘  │
│  │ :11434   │                                          │
│  └──────────┘                                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  FastAPI (Internal API — consumed by PRD-02 UI)  │  │
│  │  GET /api/health → { status: WARMING_UP | OK }   │  │
│  │  POST /feeds     GET /queue     POST /retry      │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Data flow for a single episode:**
1. Feed poller (worker polling loop) or user action → episode record inserted with `status=pending`
2. Worker pre-warm complete → worker picks up task from PostgreSQL job queue
3. Downloads audio → updates `status=downloading`; auto-retries on transient failures (max 3)
4. `ffmpeg` converts to 16kHz WAV
5. Whisper transcribes → segments written to DB → updates `status=transcribing`
6. **Whisper unloaded from memory**
7. pyannote diarizes → speaker labels merged into segments → updates `status=diarizing`
   - If diarization fails: segments preserved, `has_diarization=false`, `diarization_error` populated
8. `ffmpeg` compresses to MP3 64kbps → updates `status=archiving`
   - If disk full: marked `FAILED` with `error_class=DISK_FULL`; raw file preserved
9. Episode marked `status=done`, flat `.txt` written (with or without speaker labels)

---

## 10. Internal API Endpoints

```
POST   /api/feeds                    Add a new RSS feed
GET    /api/feeds                    List all feeds
DELETE /api/feeds/{id}               Remove a feed (and optionally its episodes)

POST   /api/episodes/ingest          Manually ingest a single audio URL
GET    /api/episodes                 List episodes (filterable by feed, status)
GET    /api/episodes/{id}            Get episode detail + segments

GET    /api/queue                    Get current queue state (pending/active/failed counts, worker status)
POST   /api/queue/{task_id}/retry    Retry a failed job (only valid for non-system failures)

GET    /api/health                   Health check — includes worker warm-up state
```

---

## 11. Feature Roadmap

### MVP (Phase 1) — Done
- Single worker processing one episode at a time (PostgreSQL-backed job queue)
- RSS feed addition and 24-hour polling (worker polling loop)
- WhisperX transcription with word-level timestamps (CTranslate2 backend)
- Sequential model loading (Whisper unloaded before pyannote)
- Model pre-warm step with `WARMING_UP` health state
- pyannote diarization with SPEAKER_N labels; graceful failure path
- PostgreSQL storage with FTS index, `error_class`, `diarization_error` fields
- Flat .txt transcript file output (with/without speaker labels)
- Audio archived to MP3 64kbps; disk-full handled gracefully
- Auto-retry on transient access failures (max 3, exponential backoff)
- FastAPI internal API
- Docker Compose setup with single `docker compose up`

### V1 (Phase 2) — Done
- Configurable Whisper model size (tiny/base/small/medium/large-v3/large-v3-turbo) via env var
- Semantic search with embeddings (pgvector)
- RAG-based Ask AI feature via Ollama
- Chunking and embedding pipeline tasks
- Notification system (email, Telegram)
- Zombie job detection

### Future
- GPU support via Docker NVIDIA runtime flag
- Episode chapter detection
- Feed pause/resume (stop polling without deleting)

---

## 12. Testing Strategy

### Unit Tests (`pytest`)
- RSS parser: valid feed, malformed feed, missing enclosure, duplicate GUID
- Timestamp alignment: majority-overlap logic, tie-breaking (earlier start wins)
- Episode status machine: valid transitions, invalid transition rejection
- Error classification: assert correct `error_class` for each failure type
- Auto-retry logic: assert retry fires for `TRANSIENT_NETWORK`, does not fire for `DISK_FULL` or `OOM`
- API endpoints: mocked DB, assert response shapes and status codes
- Config parsing: missing required vars, invalid values

### Integration Tests
- A 10-second real audio fixture (`tests/fixtures/sample.mp3`) ships in the repo
- Full pipeline test: download → transcribe → diarize → store → assert segment count and timestamp range
- Diarization failure path: mock pyannote to raise exception → assert `has_diarization=false`, `diarization_error` populated, segments still present
- Disk-full path: mock `ffmpeg` archival to raise `OSError: [Errno 28]` → assert `error_class=DISK_FULL`, raw file not deleted
- Uses a separate `test` PostgreSQL database spun up via `docker compose -f docker-compose.test.yml`

### End-to-End Tests
- Spin up full stack in Docker
- POST a known RSS feed (static mock feed served by test container)
- Wait for job completion (poll `/api/queue` until done)
- Assert segments exist in database for the test episode
- Assert `.txt` transcript file written to volume

### What is NOT tested
- Whisper model quality / accuracy
- pyannote model quality
- Network reliability for external RSS/audio URLs (mocked in all tests)

---

## 13. Resolved Questions

| #     | Question                            | Decision                                                                                                                         |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| OQ-01 | Per-feed Whisper model size?        | Global config only (V1)                                                                                                          |
| OQ-02 | Auto-retry on failure?              | Yes — 3 retries with exponential backoff for `TRANSIENT_NETWORK` and `HTTP_ACCESS` only. `DISK_FULL` and `OOM` fail immediately. |
| OQ-03 | Disk full during archival?          | Mark `FAILED` with `error_class=DISK_FULL`, preserve raw audio, no auto-retry, direct user to free space.                        |
| OQ-04 | Write `.txt` if diarization failed? | Yes — always write transcript. Omit speaker labels. Add failure header comment.                                                  |

---

## 14. Environment Variables

```env
# Required
POSTGRES_PASSWORD=changeme
HF_TOKEN=hf_xxxxxxxxxxxx

# Optional
WHISPER_MODEL=large-v3-turbo       # tiny|base|small|medium|large-v3|large-v3-turbo
WHISPER_COMPUTE_TYPE=int8          # int8 (fast, recommended for CPU) | float32 (accurate)
WHISPER_BATCH_SIZE=16              # WhisperX batched inference batch size
DATA_DIR=/data
ARCHIVE_AUDIO=true
AUDIO_ARCHIVE_BITRATE=64k
FEED_POLL_INTERVAL_HOURS=24
RETRY_MAX=3                        # Max auto-retries for transient failures (default: 3)
RETRY_BACKOFF_BASE=30              # Base backoff seconds; actual = base * 2^(attempt-1)
DISK_HEADROOM_BYTES=2147483648     # 2 GB minimum free space before download starts (GAP-06)
OLLAMA_URL=http://ollama:11434     # Ollama API endpoint for LLM inference
```
