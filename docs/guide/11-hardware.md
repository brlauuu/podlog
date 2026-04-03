# Hardware & Performance

Podlog runs entirely on CPU. Here's what to expect for processing times and storage.

## How Long Will My Episodes Take?

**Rules of thumb with `large-v3-turbo` (default):**

- Transcription: ~0.6x realtime (a 1-hour episode takes ~36 minutes)
- Diarization: ~0.9x realtime (a 1-hour episode takes ~54 minutes)
- Total per 1-hour episode: ~90 minutes on a modern 8-core CPU

| Machine Class | 1-Hour Episode | 3-Hour Episode |
|---|---|---|
| Modern 8-core (Ryzen 7, Apple M-series) | ~90 min | ~4.5 hours |
| Older 4-core (i5 7th gen) | ~150 min | ~7.5 hours |
| Low-power (NUC, ARM SBC) | ~240 min | ~12 hours |

Episodes are processed sequentially (one at a time). A backlog of 100 one-hour episodes on an 8-core machine would take roughly 6 days.

## How Much Disk Space Do I Need?

Base overhead: ~15 GB for Docker images and model cache.

| Library Size | Audio Archive | Database | Total (incl. base) |
|---|---|---|---|
| 100 episodes (1hr avg) | ~0.4 GB | ~200 MB | ~16 GB |
| 500 episodes | ~2 GB | ~1 GB | ~18 GB |
| 1,000 episodes | ~3.5 GB | ~2 GB | ~21 GB |
| 5,000 episodes | ~17 GB | ~10 GB | ~42 GB |

To save disk, set `ARCHIVE_AUDIO=false` — transcripts remain searchable but audio playback is unavailable.

## Model Size vs Quality

Smaller models trade accuracy for speed and lower memory:

| Model | Speed vs Default | Quality | Notes |
|---|---|---|---|
| `large-v3-turbo` | 1x (baseline) | Near-best | **Recommended default** |
| `medium` | ~1.3x faster | Good | Best choice for 8 GB machines |
| `small` | ~2.5x faster | Medium | Quick results, lower accuracy |
| `tiny` | ~6x faster | Low | Only useful for keyword search |

## Full Benchmarks

For detailed per-episode processing times, storage breakdowns, and the tested machine specs, see [docs/hardware.md](../hardware.md).

---

**Next:** [RAG Search](12-rag-search.md) | **Back:** [Configuration](10-configuration.md) | **Home:** [Guide](README.md)
