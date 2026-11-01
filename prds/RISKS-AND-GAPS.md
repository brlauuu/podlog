# Podlog — Risks, Gaps & Hardware Requirements

**Project:** Podlog — Self-hosted Podcast Transcription & Search  
**Document:** RISKS-AND-GAPS
**Version:** 1.12
**Status:** Living document — update as risks are resolved or new ones are identified  
**How to use:** When a risk is mitigated or a gap is closed, move it to the Resolved section at the bottom with a note on how it was addressed. Add new entries as they are discovered during development.

**Changelog:**
- v1.12 — RISK-09 (meta-analysis recompute cost) and RISK-10 (`tiktoken` image size) closed: the Meta-Analysis feature and its snapshot were removed (#1134).
- v1.11 — GAP-07: the episode language is now judged across the whole episode rather than its first 30 s (PRD-01 v1.14), which fixes an episode whose intro is in another language. Mixed-language episodes are still decoded in one language.
- v1.10 — Added GAP-07: batched transcription detects one language per episode, and the detection is not stable between runs (4a3387d6 came out `hr` once and `sr` the next time). Repetition loops it caused are now re-decoded (PRD-01 §5.4); mixed-language episodes are still decoded in a single language.
- v1.9 — Added a resolved gap: languages without a WhisperX alignment model (51 Serbian episodes) silently lost word timestamps and fell back to segment-level speaker assignment. #1093 closes it with native faster-whisper word timestamps as the fallback, recorded per episode.
- v1.8 — Added a resolved gap: no alert when a stage keeps failing or the queue stops moving. Pipeline alerts (#1099) close it.
- v1.7 — Remote inference removed (#1092); Podlog is fully self-hosted. RISK-08 (remote provider availability / rate limits) and RISK-11 (audio egress to pyannote.ai, and the stored `pyannote_api_key`) moved to Resolved: no stage calls a third-party inference service, and stored provider settings and API keys are deleted at startup by `app/services/remote_retirement.py`.
- v1.6 — Added RISK-11 (audio egress to third party when `DIARIZATION_PROVIDER=precision2`). Documented as the accepted cost of offering pyannote.ai cloud diarization; local remains the free, no-egress default. VERSION bumped to 0.3.0.
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
- pyannote speaker-diarization-community-1: ~2 GB resident during diarization
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
**Mitigation:** Resolved in PRD-01 v1.1 via the model pre-warm step (§5.11) and a `WARMING_UP` health state exposed at `GET /api/health` (`app/api/health.py`). The queue dashboard banner that originally surfaced this was removed in PRD-02 v1.3 — warm-up is brief enough that a persistent UI element is no longer warranted; the health state remains available for operators and external monitoring.  
**Status:** Mitigated in v1.1; UI surface simplified in v1.3 (banner removed, health state retained).

---

### ~~RISK-04: Diarization Alignment Quality~~ → Resolved in v1.5

*Moved to Part 4: Resolved Items.*

---

### RISK-05: Path Traversal in Audio File Serving (Mitigated in v1.1)

**Severity:** High  
**Component:** PRD-02 — `/api/audio` route  
**Description:** The original PRD-02 v1.0 audio serving route constructed a file path from user-supplied URL parameters without validation. A crafted request like `/api/audio/fake-id/../../../../etc/passwd` could potentially read arbitrary files from the container filesystem.  
**Mitigation:** Resolved in PRD-02 v1.1 (§5.2, §11). The route now treats the filename parameter as a basename only (path separators stripped), resolves the full path, and verifies it stays within the allowed audio directories before serving. Those are both `/data/audio/archive/` and `/data/audio/raw/` (`AUDIO_DIRS` in the route), not archive alone — raw is needed to serve episodes that have not been archived yet.  
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

### ~~RISK-08: Remote Inference Provider Availability / Rate Limits~~ → Resolved in v1.7

*Moved to Part 4: Resolved Items.*

---

### RISK-09: Meta-Analysis Recompute Cost Scales with Corpus

**Status:** Closed (#1134). The Meta-Analysis feature, its snapshot and the worker idle hook that recomputed it were removed.

### RISK-10: `tiktoken` Adds ~8 MB to the Pipeline Image

**Status:** Closed (#1134). `tiktoken` was used only for the Meta-Analysis token counts and is no longer a dependency.

### ~~RISK-11: Audio Egress to Third Party via pyannote Cloud~~ → Resolved in v1.7

*Moved to Part 4: Resolved Items.*

---

### RISK-12: Telegram Bot Is a Remote Surface Keyed on Telegram Accounts

**Severity:** Medium
**Component:** PRD-07 — Telegram bot (`app/services/telegram_bot.py`) — Issue #1034
**Description:** Until #1034 the trust boundary was the LAN (#960, #988). The bot moves it: any Telegram account whose numeric user ID is on `telegram_allowed_user_ids` can query Podlog from anywhere, through Telegram's servers, with no port opened. Podlog has no notion of a user beyond that list, so a compromised or shared Telegram account on the list has whatever the bot has. Today that is reading (queue state, `/search`, `/ask`, `/transcript`, and the install's LAN address via `/address`, #1068) plus one write, `/addfeed` (#1053), so the exposure is the transcripts' contents and the ability to add a podcast source, not control of the install: nothing the bot accepts deletes, reprocesses, or changes a setting.
**Mitigation:**
1. Deny by default: the loop does not call `getUpdates` at all until a token and a non-empty allowlist exist; an empty list means off, never open.
2. Allowlist by immutable numeric user ID, not by username (mutable, optional) or phone number (never exposed to bots).
3. Every command is read-only except `/addfeed`, which is additive and reversible on the Feeds page. Any other write would need its own issue, its own confirmation step, and an update to this entry.
4. Refusals are logged with the sender's ID; `docs/guide/01-installation.md` Security model tells operators what listing an account means.

**Status:** Active. Accepted as the cost of remote access without a VPN.

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

### GAP-07: One Language per Episode, Detected Unstably

**Component:** PRD-01 §5.4  
**Description:** The batched pipeline detects the language once per episode and decodes every chunk in it (`multilingual=False`). A mixed English/Serbian interview is decoded entirely as one language, and the detection itself is not stable: 4a3387d6 came out `hr` in one run and `sr` in the next, which also decides whether wav2vec2 or native word times are used. The worst symptom, repetition loops over the other language's speech, is mitigated by re-decoding looping chunks (PRD-01 v1.12). Detection used to look only at the first 30 s, so a Serbian sponsor spot made 4a3387d6's English interview Serbian or Croatian; it now sums probabilities over five windows across the episode (PRD-01 v1.14), so the intro no longer decides, but an episode that switches language halfway is still decoded in its majority language.  
**Proposed fix:** Measure `multilingual=True` (per-chunk detection) on mixed-language episodes, and consider pinning a feed's language once known. Not done yet because per-chunk languages would also need per-chunk alignment models.  
**Target phase:** Next

---

### ~~GAP-06: No Disk Space Pre-Check Before Download~~ → Resolved in v1.2

*Moved to Part 4: Resolved Items.*

---

## Part 4: Resolved Items

| ID | Item | Resolution | Version |
|---|---|---|---|
| RISK-03 | Model download silently blocks jobs | Model pre-warm step + `WARMING_UP` health state at `GET /api/health` (queue UI banner removed in PRD-02 v1.3 — warm-up is brief; health state retained for operators) | v1.1 |
| RISK-05 | Path traversal in audio serving | Basename extraction + path prefix validation in `/api/audio` route | v1.1 |
| GAP-N/A | Migration race condition (web starts before schema exists) | Pipeline healthcheck + `web` depends on `service_healthy` | v1.1 |
| GAP-N/A | Whisper+pyannote simultaneous memory load | Explicit unload + GC between transcription and diarization stages | v1.1 |
| GAP-N/A | Pagination count missing | Companion `COUNT(*)` query added to search API route | v1.1 |
| GAP-02 | No RSS feed validation on add | `validate_and_parse_feed()` in `rss.py` fetches + parses before persisting; 422 on failure | v1.2 |
| GAP-06 | No disk space pre-check before download | `shutil.disk_usage()` check against `DISK_HEADROOM_BYTES` (default 2 GB) before download | v1.2 |
| GAP-N/A | `updated_at` missing from episodes table | Added `updated_at` to episodes model (prerequisite for GAP-01 zombie detection) | v1.2 |
| GAP-N/A | Next.js standalone output missing | Added `output: 'standalone'` to `next.config.mjs` (required for Docker build) | v1.2 |
| GAP-01 | Zombie job cleanup | Periodic task every 30 min — queries episodes stuck in non-terminal status for >2 h and marks them `failed` with `error_class=SYSTEM_ERROR` (`app/tasks/cleanup.py`) | v1.3 |
| GAP-03 | No episode re-processing | Episode reprocessing implemented — resets status to `pending`, clears segments, re-enqueues through the pipeline | v1.3 |
| RISK-07 | Celery Beat single point of failure | No longer applicable — Celery/Redis replaced by PostgreSQL-backed job queue with polling loop in `worker.py` | v1.3 |
| RISK-04 | Diarization alignment quality (segment-level mis-attribution) | WhisperX with wav2vec2 word-level alignment shipped (see PRD-01 §5.4); `apps/pipeline/app/services/whisper.py` + `alignment.py` implement word-level speaker assignment | v1.5 |
| GAP-04 | Word-level alignment not implemented | WhisperX CTranslate2 + wav2vec2 word-level timestamps align transcript words against pyannote segments, replacing majority-overlap at the segment level | v1.5 |
| GAP-N/A | Meta-analysis stale-flag race drops recompute signal | `set_stale` writes a UUID token; `recompute_and_store` captures the token before `compute_snapshot` and only clears it if the token is unchanged — concurrent `set_stale` during compute keeps the flag stale. TS `setMetaAnalysisStale` mirrors the token write. | v0.2.0 |
| RISK-08 | Remote inference provider availability / rate limits (Fireworks) | No longer applicable — remote inference removed in #1092; transcription, diarization, embeddings and Ask all run locally, so no stage depends on a third-party API's availability, quotas or rate limits | v1.7 |
| RISK-11 | Audio egress to pyannote.ai (`DIARIZATION_PROVIDER=precision2`) and storage of `pyannote_api_key` | No longer applicable — pyannote.ai diarization removed in #1092; audio never leaves the host. `app/services/remote_retirement.py` deletes stored provider settings and API keys (`pyannote_api_key`, `fireworks_api_key`, …) at worker and pipeline API startup, and warns about retired env vars still set | v1.7 |
| GAP-N/A | No alert when a stage keeps failing or the queue stops moving (transcription failed silently 2026-10-20 → 10-28) | Worker periodic task `app/services/pipeline_alerts.py` (#1099): one notification for a failure streak at one stage or a stalled queue, one on recovery; thresholds `PIPELINE_ALERT_FAILURE_STREAK` / `PIPELINE_ALERT_STALL_HOURS` | v1.8 |
| GAP-N/A | Languages without a WhisperX alignment model (Serbian: 51 episodes) silently lost word timestamps; diarization assigned one speaker per ~25 s segment | `app/services/whisper.py` (#1093) transcribes with faster-whisper `word_timestamps=True`, re-aligns with wav2vec2 where a model exists, and keeps the native word times otherwise. The source is stored in `episodes.word_timestamps` and shown on the episode page; existing Serbian episodes need re-processing to benefit | v1.9 |
