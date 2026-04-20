# Episode Lifecycle and Data Requirements

This document describes the complete processing pipeline for an episode and what data each Podlog feature requires to function correctly.

## Pipeline Stages

An episode moves through these stages sequentially. Each stage produces specific data that downstream features depend on.

```
pending → download → transcribe → diarize → chunk → embed → infer → archive → done
```

### 1. Download

**Status:** `downloading` / `downloading:NN` (progress %)

**What it does:**
- Downloads audio from `audio_url` to local disk
- Pre-checks disk space before starting
- Classifies errors for retry logic (transient vs permanent)

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `audio_local_path` | episodes | Path to raw downloaded audio file |

**Failure mode:** Retries transient errors (`TRANSIENT_NETWORK`, `HTTP_ACCESS`) up to `retry_max` with exponential backoff. Fails immediately on `DISK_FULL`.

---

### 2. Transcribe

**Status:** `transcribing`

**What it does:**
- Converts audio to 16kHz mono WAV via ffmpeg
- Runs Whisper large-v3 (or configured model)
- Writes segments to database
- Saves word-level alignment data to `{episode_id}.whisperx.json` if available
- **Explicitly unloads Whisper from memory** (mandatory — Whisper + pyannote must never coexist)

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `text` | segments | Transcribed text per segment |
| `start_time` / `end_time` | segments | Timing boundaries |
| `speaker_label` | segments | Initially NULL (set by diarization) |
| `language` | episodes | Detected language code |
| `transcribe_duration_secs` | episodes | Processing time |

**Failure mode:** Fatal — episode marked `failed` if Whisper crashes.

---

### 3. Diarize

**Status:** `diarizing`

**What it does:**
- Runs pyannote community-1 on the audio (configurable via `PYANNOTE_MODEL`)
- If word-level alignment exists, assigns speakers per word and rebuilds segments at speaker boundaries
- Falls back to segment-level majority overlap if no word data
- Requires `HF_TOKEN` environment variable

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `speaker_label` | segments | `SPEAKER_00`, `SPEAKER_01`, etc. |
| `has_diarization` | episodes | `true` if diarization succeeded |
| `diarization_error` | episodes | Error message if failed (NULL on success) |
| `diarize_duration_secs` | episodes | Processing time |

**Failure mode:** **Non-fatal.** If pyannote fails, the episode continues with `has_diarization = false` and `speaker_label = NULL` on all segments. Search and playback still work, just without speaker attribution.

---

### 4. Chunk

**Status:** `chunking`

**What it does:**
- Merges diarized segments into larger speaker-turn chunks for higher-quality RAG retrieval
- Rebuilds chunks idempotently for the episode (removes old chunks first)
- Enqueues the embed step when finished

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `text` | chunks | Merged speaker-turn text |
| `start_time` / `end_time` | chunks | Chunk timing boundaries |
| `speaker_label` | chunks | Speaker label carried from diarized segments |
| `segment_ids` | chunks | Source segment IDs merged into each chunk |

**Failure mode:** Non-fatal — pipeline continues to embed even if chunking fails.

---

### 5. Embed

**Status:** `embedding`

**What it does:**
- Loads all segments for the episode
- Batch-embeds segment text using `all-MiniLM-L6-v2` (384 dimensions)
- Stores vectors in `segments.embedding` column
- Model stays loaded in memory (80 MB — small enough to keep resident)

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `embedding` | segments | 384-dim normalized vector per segment |
| `embedding` | chunks | 384-dim normalized vector per merged chunk |

**Failure mode:** Non-fatal — episode continues to infer. Segments without embeddings are excluded from vector search but still found by FTS.

---

### 6. Infer (Speaker Name Inference)

**Status:** `inferring`

**What it does:**
- Extracts host/guest names from episode title and description using spaCy NER (`en_core_web_lg`)
- Maps names to speaker labels (SPEAKER_00 = host, others = guests)
- Pre-populates `speaker_names` table with inferred display names
- Skipped if diarization failed or inference is disabled in config

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `display_name` | speaker_names | Human-readable name (e.g., "John Smith") |
| `speaker_label` | speaker_names | Mapped diarization label |
| `inferred` | speaker_names | `true` (these are auto-generated) |
| `confidence` | speaker_names | `HIGH` / `MEDIUM` / `LOW` |
| `inference_skipped` | episodes | `true` if skipped (no diarization or disabled) |
| `inference_error` | episodes | Error message if NER failed |

**Failure mode:** **Non-fatal.** If inference fails or is skipped, episode continues. Speaker labels show as `SPEAKER_00` etc. until user manually renames.

---

### 7. Archive

**Status:** `archiving` → `done`

**What it does:**
- Compresses audio to MP3 64kbps (if `archive_audio` enabled)
- Writes flat `.txt` transcript file with speaker labels and timestamps
- Marks episode `done` with `processed_at` timestamp
- Emits notification event (email/Telegram)
- Deletes raw audio after confirming status persisted

**Data produced:**
| Field | Table | Description |
|-------|-------|-------------|
| `audio_local_path` | episodes | Updated to archived MP3 path |
| `transcript_path` | episodes | Path to `.txt` transcript file |
| `status` | episodes | Set to `done` |
| `processed_at` | episodes | Completion timestamp |

**Failure mode:** Fatal for disk full. If no segments exist at archival time, episode is marked `failed`.

---

## Feature Data Requirements

### Full-Text Search (FTS)
**Status:** Working

| Requirement | Source | Notes |
|-------------|--------|-------|
| `segments.text` | Transcribe | The searchable content |
| `segments.start_time` / `end_time` | Transcribe | For timestamp links |
| `segments.speaker_label` | Diarize | For speaker-turn grouping (optional — works without) |
| `speaker_names.display_name` | Infer | For showing names in results (optional — falls back to label) |
| GIN index on `to_tsvector(text)` | Migration | `segments_text_fts` |

**Minimum viable:** Transcribe complete. Works without diarization or speaker names.

---

### Hybrid Search (FTS + Vector)
**Status:** Working

Everything from FTS, plus:

| Requirement | Source | Notes |
|-------------|--------|-------|
| `segments.embedding` | Embed | 384-dim vector for similarity search |
| HNSW index on `embedding` | Migration | `segments_embedding_hnsw` |
| Embed API (`POST /api/embed`) | Pipeline | For embedding the user's query at search time |

**Minimum viable:** Transcribe + Embed complete. Degrades gracefully to FTS-only if embeddings missing.

---

### Audio Playback
**Status:** Working

| Requirement | Source | Notes |
|-------------|--------|-------|
| `episodes.audio_local_path` | Archive | Path to archived MP3 |
| `episodes.audio_url` | Download | Fallback to original URL if no local file |
| `segments.start_time` | Transcribe | For seeking to timestamp |

---

### Speaker Labels and Renaming
**Status:** Working

| Requirement | Source | Notes |
|-------------|--------|-------|
| `segments.speaker_label` | Diarize | `SPEAKER_00`, `SPEAKER_01`, etc. |
| `speaker_names` table | Infer / User | Auto-inferred or manually set display names |
| `episodes.has_diarization` | Diarize | UI shows/hides speaker features based on this |

**Minimum viable:** Diarize complete. Speaker names are optional enhancement.

---

### Notifications (Email / Telegram)
**Status:** Working

| Requirement | Source | Notes |
|-------------|--------|-------|
| `episodes.status = 'done'` | Archive | Triggers done notification |
| `episodes.status = 'failed'` | Any stage | Triggers failure notification |
| Processing duration fields | Transcribe/Diarize | Included in notification body |
| Queue status | Job queue | "N remaining, est. X minutes" |

---

### RAG Search ("Ask" Page)
**Status:** Working

Everything from Hybrid Search, plus:

| Requirement | Source | Notes |
|-------------|--------|-------|
| `chunks` table | Chunk task | Merged speaker-turn text (~400 tokens) with embeddings |
| `chunks.embedding` | Chunk task | 384-dim vector on the merged chunk (better quality than per-segment) |
| HNSW index on `chunks.embedding` | Migration | For fast retrieval |
| Ollama service | docker-compose.yml | Local LLM for answer generation |
| RAG endpoint (`POST /api/ask`) | Pipeline API | Retrieval + prompt + streaming |
| Ask page UI | `/ask` page | Frontend for streaming answers with citations |

**Minimum viable:** Chunks table populated + Ollama running + RAG endpoint + Ask page.

---

## Episode Completeness Checklist

A fully processed episode ready for all current and planned features:

| Check | Field/Query | Expected |
|-------|-------------|----------|
| Downloaded | `audio_local_path IS NOT NULL` | Has local audio file |
| Transcribed | `segments` exist for episode | At least 1 segment |
| Diarized | `has_diarization = true` | Speaker labels assigned (non-fatal if false) |
| Embedded | All segments have `embedding IS NOT NULL` | 100% coverage |
| Speaker names | `speaker_names` rows exist | At least host identified (non-fatal if missing) |
| Chunked | `chunks` rows exist for episode | Produced by chunk task |
| Chunk embeddings | All chunks have `embedding IS NOT NULL` | Produced by chunk task |
| Archived | `status = 'done'` AND `processed_at IS NOT NULL` | Episode fully processed |
| Transcript file | `transcript_path IS NOT NULL` | Flat `.txt` file written |

### Quick DB query to check episode health

```sql
SELECT
  e.id,
  e.title,
  e.status,
  e.has_diarization,
  e.inference_skipped,
  e.inference_error,
  (SELECT COUNT(*) FROM segments s WHERE s.episode_id = e.id) AS segments,
  (SELECT COUNT(*) FROM segments s WHERE s.episode_id = e.id AND s.embedding IS NOT NULL) AS embedded,
  (SELECT COUNT(*) FROM speaker_names sn WHERE sn.episode_id = e.id) AS speaker_names,
  e.processed_at
FROM episodes e
WHERE e.status = 'done'
ORDER BY e.processed_at DESC;
```
