# Hardware Guide

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB+ |
| Storage (base) | 45 GB (Docker images + model cache) | 60 GB+ |
| Storage (per 1000 1-hour episodes) | ~33 GB (audio archive at 64 kbps + database) | — |
| GPU | Not required | Not required |

**CPU note:** Whisper inference is compute-bound but single-threaded per episode. More cores keep PostgreSQL and Next.js responsive while the worker runs, but don't speed up individual transcriptions.

**GPU note:** Podlog runs entirely on CPU. GPU acceleration is not configured. All processing times below are CPU-only.

## Tested Machine

Podlog was developed and tested on:

| Component | Spec |
|---|---|
| CPU | AMD Ryzen 7 PRO 5850U (8 cores, 16 threads, 1.9-4.4 GHz) |
| RAM | 42 GB DDR4 |
| Storage | 1 TB NVMe SSD |
| OS | Ubuntu 24.04.4 LTS |
| Docker | 29.3.1 |
| Docker Compose | 5.1.1 |

## Processing Benchmarks

Measured on the machine above with `WHISPER_MODEL=large-v3-turbo`, `WHISPER_COMPUTE_TYPE=int8`.

### Per-Episode Processing Time

| Episode Duration | Transcription | Diarization | Embedding | Total |
|---|---|---|---|---|
| 53 min | 32 min | 57 min | ~3 sec | ~89 min |
| 62 min | 38 min | 64 min | ~3 sec | ~102 min |
| 75 min | 41 min | 68 min | ~3 sec | ~109 min |
| 97 min | 55 min | 93 min | ~3 sec | ~148 min |
| 111 min | 63 min | 100 min | ~3 sec | ~163 min |

The **Total** column is transcription + diarization only. Chunking, speaker inference and archiving add roughly 2 minutes more per episode, and embedding is the ~3 seconds shown.

**Rules of thumb (CPU-only, large-v3-turbo):**
- Transcription: ~0.6x realtime (a 1-hour episode takes ~36 minutes)
- Diarization: ~1.0x realtime (a 1-hour episode takes ~60 minutes). The five measured rows below run 0.90x–1.08x; treat parity with real time as the planning figure.
- Embedding: negligible (~5ms per segment, ~3 seconds for 500 segments)
- Speaker inference + archiving: ~2 minutes combined

### Batch Processing

Processing 10 episodes (13 hours total audio) took approximately 19 hours end-to-end on the tested machine. Episodes are processed sequentially (concurrency=1) to avoid OOM.

### Estimated Times by Machine Class

| Machine | 1-hour episode | 3-hour episode |
|---|---|---|
| Modern 8-core (AMD Ryzen 7, Apple M-series) | ~90 min | ~4.5 hours |
| Older 4-core (Intel Core i5 7th gen) | ~150 min | ~7.5 hours |
| Low-power (Intel NUC, ARM SBC) | ~240 min | ~12 hours |

## Storage Estimates

Both figures below are **measured on the reference machine**, not estimated, against a library of 985 processed episodes / 1,283 hours of audio / 894,524 segments:

- **Audio archive: ~29 MB per hour of audio** (`ARCHIVE_AUDIO=true`, 64 kbps MP3). 37.8 GB for those 1,283 hours. This matches the arithmetic — 64 kbps is 28.8 MB per hour before container overhead.
- **Database: ~3.6 MB per hour of audio.** 4,637 MB for the same library, covering segments, speaker turns, chunks and both sets of vectors.

Projected to 1-hour episodes:

| Episodes (1hr avg) | Audio Archive | Database | Total (incl. base) |
|---|---|---|---|
| 100 | ~2.9 GB | ~0.4 GB | ~48 GB |
| 500 | ~15 GB | ~1.8 GB | ~62 GB |
| 1,000 | ~29 GB | ~3.6 GB | ~78 GB |
| 5,000 | ~147 GB | ~18 GB | ~210 GB |

The `embedding vector(384)` column adds ~1.5 KB per segment (~18 MB for 12,000 segments) — real, but small next to audio.

To drop the audio column entirely, set `ARCHIVE_AUDIO=false`. Transcripts stay fully searchable; you lose playback.

### Base overhead

**Budget ~45 GB before you ingest anything.** Measured on the reference machine, unique layer sizes for the six default-profile images:

| Image | On-disk |
|---|---|
| `podlog-worker` | 16.1 GB |
| `podlog-pipeline` | 12.5 GB |
| `ollama/ollama` | 8.4 GB |
| `pgvector/pgvector:pg15` | 0.5 GB |
| `podlog-web` | 0.3 GB |
| `podlog-backup` | 0.1 GB |
| shared layers (counted once) | 0.9 GB |
| **Total images** | **~39 GB** |

Plus the `podlog_model_cache` volume — Whisper, pyannote, spaCy and the embedding model — at **~5.7 GB** once everything has been downloaded.

Ask AI models are pulled separately and on top: `qwen2.5:3b` is 1.9 GB and `phi3:mini` is 2.2 GB; `gemma3n:e4b` is larger again. `make ollama-pull` fetches all three.

The worker and pipeline images are large because they carry the full machine-learning stack. Issue [#937](https://github.com/brlauuu/podlog/issues/937) hit the same numbers from the other direction: the release workflow builds each image in its own CI job because a standard runner has about 14 GB of disk and these two do not fit alongside each other.

## Whisper Model Comparison

Smaller models trade accuracy for speed and lower memory usage.

| Model | Size | Peak RAM | Speed vs large-v3 | Quality |
|---|---|---|---|---|
| `tiny` | 39 MB | ~1 GB | ~10x faster | Low — usable for keyword search, not reading |
| `base` | 74 MB | ~1 GB | ~7x faster | Low-medium |
| `small` | 244 MB | ~2 GB | ~4x faster | Medium |
| `medium` | 769 MB | ~5 GB | ~2x faster | Good |
| `large-v3` | 1.5 GB | ~10 GB | 1x (baseline) | Best |
| `large-v3-turbo` | 809 MB | ~6 GB | ~1.5x faster | Near-best (recommended) |

**Recommendation:** Use `large-v3-turbo` (default) for the best balance of quality and speed. Drop to `medium` on 8 GB machines, or `small` on 4 GB machines.
