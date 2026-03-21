# Hardware Guide

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB+ |
| Storage (base) | 15 GB (Docker images + model cache) | 20 GB |
| Storage (per 1000 episodes) | ~5 GB (with audio archive at 64kbps) | — |
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
| Docker | 29.3.0 |
| Docker Compose | 5.1.0 |

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

**Rules of thumb (CPU-only, large-v3-turbo):**
- Transcription: ~0.6x realtime (a 1-hour episode takes ~36 minutes)
- Diarization: ~0.9x realtime (a 1-hour episode takes ~54 minutes)
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

With audio archival enabled (`ARCHIVE_AUDIO=true`, 64 kbps MP3):

| Episodes (1hr avg) | Audio Archive | Database (segments + vectors) | Total (incl. base) |
|---|---|---|---|
| 100 | ~0.4 GB | ~200 MB | ~16 GB |
| 500 | ~2 GB | ~1 GB | ~18 GB |
| 1,000 | ~3.5 GB | ~2 GB | ~21 GB |
| 5,000 | ~17 GB | ~10 GB | ~42 GB |

Base overhead: ~15 GB for Docker images, model cache, and OS.

The `embedding vector(384)` column adds ~1.5 KB per segment (~18 MB for 12,000 segments). This is negligible compared to audio storage.

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
