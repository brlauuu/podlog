# Hardware & Performance

Podlog runs entirely on CPU. Here's what to expect for processing times and storage.

## How Long Will My Episodes Take?

**Rules of thumb with `large-v3-turbo` (default):**

- Transcription: ~0.6x realtime (a 1-hour episode takes ~36 minutes)
- Diarization: ~1.0x realtime (a 1-hour episode takes ~60 minutes)
- Total per 1-hour episode: ~95 minutes on a modern 8-core CPU, plus a couple of minutes for chunking, speaker inference and archiving

| Machine Class | 1-Hour Episode | 3-Hour Episode |
|---|---|---|
| Modern 8-core (Ryzen 7, Apple M-series) | ~90 min | ~4.5 hours |
| Older 4-core (i5 7th gen) | ~150 min | ~7.5 hours |
| Low-power (NUC, ARM SBC) | ~240 min | ~12 hours |

Episodes are processed sequentially (one at a time). A backlog of 100 one-hour episodes on an 8-core machine would take roughly 6 days.

## How Much Disk Space Do I Need?

More than you might expect. **Budget ~25 GB before ingesting a single episode**: Ollama is 8.4 GB, the worker image carries the full machine-learning stack at 7.1 GB, the rest of the images add ~3.5 GB, and the model cache another ~5.7 GB once Whisper, pyannote, spaCy and the embedding model have downloaded.

After that, measured on a real 985-episode library: **~29 MB per hour of audio** archived at 64 kbps, and **~3.6 MB per hour** in the database.

| Library Size | Audio Archive | Database | Total (incl. ~25 GB base) |
|---|---|---|---|
| 100 episodes (1hr avg) | ~2.9 GB | ~0.4 GB | ~28 GB |
| 500 episodes | ~15 GB | ~1.8 GB | ~42 GB |
| 1,000 episodes | ~29 GB | ~3.6 GB | ~58 GB |
| 5,000 episodes | ~147 GB | ~18 GB | ~190 GB |

To save disk, set `ARCHIVE_AUDIO=false` — transcripts remain searchable but audio playback is unavailable. That removes the largest column entirely.

Ask AI models are extra and pulled on demand: `qwen2.5:3b` is 1.9 GB, `phi3:mini` 2.2 GB, `gemma3n:e4b` larger again.

## Model Size vs Quality

Smaller models trade accuracy for speed and lower memory:

| Model | Speed vs Default | Quality | Notes |
|---|---|---|---|
| `large-v3-turbo` | 1x (baseline) | Near-best | **Recommended default**; wants 12 GB system RAM |
| `medium` | ~1.3x faster | Good | Tight on 8 GB once pyannote and PostgreSQL are accounted for |
| `small` | ~2.5x faster | Medium | The comfortable choice on 8 GB |
| `tiny` | ~6x faster | Low | Only useful for keyword search |

## Full Benchmarks

For detailed per-episode processing times, storage breakdowns, and the tested machine specs, see [docs/hardware.md](../hardware.md).

---

**Next:** [RAG Search](12-rag-search.md) | **Back:** [Configuration](10-configuration.md) | **Home:** [Guide](README.md)
