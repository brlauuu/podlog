# Podlog — Risks, Gaps & Hardware Requirements

**Project:** Podlog — Self-hosted Podcast Transcription & Search  
**Document:** RISKS-AND-GAPS
**Version:** 1.5
**Status:** Living document — update as risks are resolved or new ones are identified  
**How to use:** When a risk is mitigated or a gap is closed, move it to the Resolved section at the bottom with a note on how it was addressed. Add new entries as they are discovered during development.

**Changelog:**
- v1.5 — RISK-04 and GAP-04 (word-level alignment) moved to Resolved. WhisperX CTranslate2 + wav2vec2 word-level alignment is the default transcription stack per PRD-01 §5.4.

---

## How to Maintain This Document

This file was created as both a snapshot audit and a living reference. During development:

- **Developers** should check this file before starting work on any component — if you're about to build something listed here, read the mitigation first.
- **When a risk is resolved:** move it from the active section to the Resolved section, note the version it was addressed in, and describe the fix.
- **When a new risk is found:** add it to the appropriate section with the date discovered and the name of whoever identified it.
- **Review cadence:** revisit this document at the start of each new phase (MVP → V1 → V2).

---

## Part 1: Hardware Requirements & Scaling

### Minimum Recommended Hardware

Podlog is designed to run on a single consumer machine without a GPU. The following are the minimum recommended specs for a usable experience.

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core (x86-64) | 8-core or more |
| RAM | 8 GB | 16 GB |
| Storage (OS + Docker images) | 10 GB | 20 GB |
| Storage (model cache) | 4 GB (one-time, persistent) | 4 GB |
| Storage (audio archive) | Scales with library — see below | — |
| Storage (database) | Scales with library — see below | — |

**RAM breakdown:**
- Whisper large-v3: ~3.5 GB resident during transcription
- pyannote community-1: ~2 GB resident during diarization
- The two models are never loaded simultaneously (per PRD-01 §5.4). Peak RAM usage is ~4 GB for Whisper. Total system RAM of 8 GB is functional but tight — 16 GB is strongly recommended to avoid the OS killing the worker process during transcription.
- If RAM is limited, set `WHISPER_MODEL=medium` or `WHISPER_MODEL=small` in `.env`. This trades accuracy for a ~2x and ~4x reduction in memory use respectively.

**CPU note:** Whisper on CPU is single-threaded for inference. More cores do not speed up a single transcription job. However, having more cores helps keep the rest of the system (PostgreSQL, Next.js, Docker overhead) responsive while the worker runs.

### Processing Time Estimates (CPU-only, large-v3)

| Machine | 1-hour episode | 3-hour episode |
|---|---|---|
| Modern 8-core (e.g. AMD Ryzen 7) | ~30–45 min | ~90–135 min |
| Older 4-core (e.g. Intel Core i5 7th gen) | ~60–90 min | ~3–4.5 hours |
| Low-power (e.g. Intel NUC, ARM) | ~90–150 min | ~4.5–7.5 hours |

These are estimates. Actual time depends on audio complexity, language, and background noise. Diarization adds approximately 20–30% on top of transcription time.

### Storage Scaling

#### Audio Archive

Archived audio is compressed to MP3 at 64 kbps (configurable). Storage use scales linearly with your library size.

| Episodes | Avg. Duration | Estimated Archive Size |
|---|---|---|
| 100 | 1 hour | ~0.4 GB |
| 500 | 1 hour | ~2 GB |
| 1,000 | 1 hour | ~3.5 GB |
| 5,000 | 1 hour | ~17 GB |

If storage is a concern, set `ARCHIVE_AUDIO=false` in `.env`. Audio files are deleted after transcription and the transcript remains fully searchable. You lose the ability to play audio locally.

#### Database Size

The PostgreSQL database stores transcript segments, metadata, and FTS indexes. Segment storage is the dominant factor.

**Approximate segment counts:**
- A 1-hour podcast at typical speech pace produces ~400–600 Whisper segments.
- Each segment row is approximately 200–400 bytes of text + metadata.
- The GIN full-text search index adds roughly 30–50% on top of raw data size.

| Episodes | Avg. Duration | Estimated DB Size |
|---|---|---|
| 100 | 1 hour | ~80–150 MB |
| 500 | 1 hour | ~400–750 MB |
| 1,000 | 1 hour | ~800 MB – 1.5 GB |
| 5,000 | 1 hour | ~4–7.5 GB |
| 10,000 | 1 hour | ~8–15 GB |

PostgreSQL with a GIN index handles this range well. Full-text search performance at 1M+ segments remains within the <500ms target with proper indexing, but query times will increase gradually beyond ~2M segments.

#### Combined Storage Estimate

For a typical podcast library of 1,000 episodes (1 hour average, audio archived):

| Component | Size |
|---|---|
| Model cache (one-time) | ~4 GB |
| Docker images | ~3–4 GB |
| Audio archive | ~3.5 GB |
| Transcripts (.txt flat files) | ~0.5 GB |
| PostgreSQL data | ~1–1.5 GB |
| **Total** | **~12–13 GB** |

### Scaling Considerations

**At 5,000+ episodes:** FTS query times may approach the 500ms budget during complex queries. Mitigation: add `pg_trgm` trigram index alongside GIN, or move to V2 semantic search with `pgvector`.

**At 10,000+ episodes:** The GIN index rebuild time (on schema changes or REINDEX) becomes significant (minutes). Plan maintenance windows.

**Single-user assumption:** The database and Next.js app are tuned for a single user. Connection pooling is not configured. If V2 adds multi-user support, add `pgBouncer` in front of PostgreSQL.

---

## Part 2: Active Risks

### RISK-01: OOM During Transcription on Low-RAM Machines

**Severity:** High  
**Component:** PRD-01 — Worker  
**Description:** Whisper large-v3 requires ~3.5 GB RAM. On machines with 8 GB total, OS overhead + Docker + PostgreSQL + the worker can push total usage to the limit. If the OS kills the worker process mid-transcription, the episode stays in `TRANSCRIBING` state indefinitely (zombie job).  
**Mitigation:**
1. Per PRD-01 §5.9, `OOM` is an error class — if the worker catches the OOM exception, it marks the job `FAILED` with `error_class=OOM`.
2. Document the hardware recommendations (above) prominently in the README.
3. Recommend `WHISPER_MODEL=medium` or `small` for machines with <16 GB RAM.
4. Known gap: if the OS kills the process with SIGKILL (rather than Python raising an exception), the worker cannot catch it. The job stalls. A periodic zombie job cleanup task marks jobs stuck in non-terminal states for >2 hours as failed.

**Status:** Fully mitigated in v1.3. Zombie job cleanup task implemented (see GAP-01 resolved).

---

### RISK-02: `#t=` Deep Links Silently Fail

**Severity:** Medium  
**Component:** PRD-02 — Search UI  
**Description:** The primary "go to this moment" feature relies on `#t=<seconds>` URL fragments. Many podcast CDN hosts serve audio without the `Accept-Ranges` header, meaning the browser cannot seek to the fragment position. The failure is silent — the audio plays from the beginning with no error shown.  
**Mitigation:**
1. The UI tooltip already documents this limitation (per PRD-02 §5.2).
2. Local playback via the persistent global audio player is the reliable path. For any episode with `audio_local_path` set, "Play locally" should be visually prominent.
3. Consider detecting seek failure in V1: after the audio element fires `canplay`, check `audio.currentTime` — if it's near 0 despite a non-zero `#t=` value, show a soft warning: *"Could not seek to timestamp. Try 'Play locally' instead."*

**Status:** Documented limitation. Detection improvement is a V1 candidate.

---

### RISK-03: First-Run Model Download Blocks Jobs Silently (Mitigated in v1.1)

**Severity:** Medium  
**Component:** PRD-01 — Worker  
**Description:** On first run, ~3 GB of model weights must be downloaded before any job can be processed. Without signalling, the user sees jobs sitting in `PENDING` with no explanation.  
**Mitigation:** Resolved in PRD-01 v1.1 via the model pre-warm step (§5.11) and the `WARMING_UP` health state surfaced in the queue dashboard banner (PRD-02 §5.6).  
**Status:** Mitigated in v1.1.

---

### ~~RISK-04: Diarization Alignment Quality~~ → Resolved in v1.5

*Moved to Part 4: Resolved Items.*

---

### RISK-05: Path Traversal in Audio File Serving (Mitigated in v1.1)

**Severity:** High  
**Component:** PRD-02 — `/api/audio` route  
**Description:** The original PRD-02 v1.0 audio serving route constructed a file path from user-supplied URL parameters without validation. A crafted request like `/api/audio/fake-id/../../../../etc/passwd` could potentially read arbitrary files from the container filesystem.  
**Mitigation:** Resolved in PRD-02 v1.1 (§5.2, §11). The route now treats the filename parameter as a basename only (path separators stripped), resolves the full path, and verifies it starts with `/data/audio/archive/` before serving.  
**Status:** Mitigated in v1.1.

---

### RISK-06: Pagination Total Count Performance

**Severity:** Low  
**Component:** PRD-02 — Search API route  
**Description:** Running a `COUNT(*)` companion query on every search request adds a second full FTS scan. At 100k segments this is negligible (<50ms). At 1M+ segments it could add 100–300ms to every search, risking the 500ms budget.  
**Mitigation:**
1. Acceptable for MVP given the expected library size.
2. In V1, cache the count for a given query+filter combination in React Query for the duration of the user's session (count rarely changes mid-search).
3. As a further optimisation, PostgreSQL's `reltuples` estimate (from `pg_class`) can provide a fast approximate count for the unfiltered case.

**Status:** Accepted for MVP. Cache optimisation is a V1 candidate.

---

### RISK-08: Remote Inference Provider Availability / Rate Limits

**Severity:** Medium  
**Component:** PRD-01 — Inference provider mode (`fireworks`)  
**Description:** When `INFERENCE_PROVIDER=fireworks`, transcription/diarization depends on external API availability, quotas, and rate limits. Bursty backfills may hit provider-side throttling and transient failures.  
**Mitigation:**
1. Keep `local` as the default provider and documented fallback mode.
2. Surface provider errors through existing episode failure/error-class paths.
3. Prefer gradual ramp-up for large backfills; avoid assuming infinite throughput.
4. Keep provider settings editable via DB-backed Settings UI and env vars for quick rollback to local mode.

**Status:** Active risk accepted in v1.4.

---

### RISK-09: Meta-Analysis Recompute Cost Scales with Corpus

**Severity:** Low  
**Component:** PRD-02 §5.11 — `apps/pipeline/app/services/meta_analysis.py`  
**Description:** `compute_snapshot` scans every row in `segments` and `chunks` (per-episode word/token counts, per-speaker WPM aggregates). On the current corpus (~100 episodes) it completes in well under a second and runs opportunistically on worker idle. As the archive grows into the thousands of episodes, the recompute will start to dominate idle windows and could thrash CPU/disk if the stale flag is hit repeatedly (every speaker rename and every pipeline stage transition sets it).  
**Mitigation:**
1. The idle hook already guards with `is_stale` so the scan only runs when data changed.
2. `recompute_and_store` uses a race-safe conditional clear, so we never recompute needlessly after a concurrent writer.
3. Manual `/api/meta-analysis/refresh` is serialized with `pg_advisory_xact_lock` to prevent double-work.
4. If compute time becomes painful, the next step is incremental aggregation (touch only the feed/episode that changed) rather than full-corpus scans. Not needed today.

**Status:** Active risk accepted in v0.2.0; monitor as corpus grows.

---

### RISK-10: `tiktoken` Adds ~8 MB to the Pipeline Image

**Severity:** Low  
**Component:** PRD-02 §5.11, PRD-03 — Pipeline Docker image  
**Description:** The `Tokens per episode` chart uses OpenAI's `tiktoken` library to count `cl100k_base` tokens per segment and chunk. `tiktoken` ships a precompiled Rust extension (~8 MB on disk) and pulls `regex` as a transitive dep. The pipeline image grew accordingly. No runtime cost beyond the import.  
**Mitigation:**
1. Import is defensive: if `tiktoken` fails to import (wheel unavailable for the platform), the dashboard falls back to zero token counts and the service logs a warning — the pipeline keeps running.
2. No action planned. Image size is still well within acceptable bounds for the self-hosted target.

**Status:** Active (accepted trade-off) in v0.2.0.

---

### ~~RISK-07: Celery Beat Single Point of Failure~~ → Resolved in v1.3

*Moved to Part 4: Resolved Items.*

---

## Part 3: Active Gaps

### ~~GAP-01: Zombie Job Cleanup~~ → Resolved in v1.3

*Moved to Part 4: Resolved Items.*

---

### ~~GAP-02: No RSS Feed Validation on Add~~ → Resolved in v1.2

*Moved to Part 4: Resolved Items.*

---

### ~~GAP-03: No Episode Re-Processing in MVP~~ → Resolved in v1.3

*Moved to Part 4: Resolved Items.*

---

### ~~GAP-04: Word-Level Alignment Not Implemented~~ → Resolved in v1.5

*Moved to Part 4: Resolved Items.*

---

### GAP-05: No Handling of Multi-Part Episodes or Chapters

**Component:** PRD-01  
**Description:** Some podcasts publish chapters or part 1/2 splits. The current model treats each RSS enclosure as a single episode with one flat segment list. There is no chapter detection or grouping.  
**Proposed fix:** Out of scope for V1. Noted as a future capability (chapter detection is listed in PRD-01 Future roadmap). No action needed until that phase.  
**Target phase:** Future

---

### ~~GAP-06: No Disk Space Pre-Check Before Download~~ → Resolved in v1.2

*Moved to Part 4: Resolved Items.*

---

## Part 4: Resolved Items

| ID | Item | Resolution | Version |
|---|---|---|---|
| RISK-03 | Model download silently blocks jobs | Model pre-warm step + `WARMING_UP` health state + queue UI banner | v1.1 |
| RISK-05 | Path traversal in audio serving | Basename extraction + path prefix validation in `/api/audio` route | v1.1 |
| GAP-N/A | Migration race condition (web starts before schema exists) | Pipeline healthcheck + `web` depends on `service_healthy` | v1.1 |
| GAP-N/A | Whisper+pyannote simultaneous memory load | Explicit unload + GC between transcription and diarization stages | v1.1 |
| GAP-N/A | Pagination count missing | Companion `COUNT(*)` query added to search API route | v1.1 |
| GAP-02 | No RSS feed validation on add | `validate_and_parse_feed()` in `rss.py` fetches + parses before persisting; 422 on failure | v1.2 |
| GAP-06 | No disk space pre-check before download | `shutil.disk_usage()` check against `DISK_HEADROOM_BYTES` (default 2 GB) before download | v1.2 |
| GAP-N/A | `updated_at` missing from episodes table | Added `updated_at` to episodes model (prerequisite for GAP-01 zombie detection) | v1.2 |
| GAP-N/A | Next.js standalone output missing | Added `output: 'standalone'` to `next.config.ts` (required for Docker build) | v1.2 |
| GAP-01 | Zombie job cleanup | Periodic task every 30 min — queries episodes stuck in non-terminal status for >2 h and marks them `failed` with `error_class=SYSTEM_ERROR` (`app/tasks/cleanup.py`) | v1.3 |
| GAP-03 | No episode re-processing | Episode reprocessing implemented — resets status to `pending`, clears segments, re-enqueues through the pipeline | v1.3 |
| RISK-07 | Celery Beat single point of failure | No longer applicable — Celery/Redis replaced by PostgreSQL-backed job queue with polling loop in `worker.py` | v1.3 |
| RISK-04 | Diarization alignment quality (segment-level mis-attribution) | WhisperX with wav2vec2 word-level alignment shipped (see PRD-01 §5.4); `apps/pipeline/app/services/whisper.py` + `alignment.py` implement word-level speaker assignment | v1.5 |
| GAP-04 | Word-level alignment not implemented | WhisperX CTranslate2 + wav2vec2 word-level timestamps align transcript words against pyannote segments, replacing majority-overlap at the segment level | v1.5 |
| GAP-N/A | Meta-analysis stale-flag race drops recompute signal | `set_stale` writes a UUID token; `recompute_and_store` captures the token before `compute_snapshot` and only clears it if the token is unchanged — concurrent `set_stale` during compute keeps the flag stale. TS `setMetaAnalysisStale` mirrors the token write. | v0.2.0 |
