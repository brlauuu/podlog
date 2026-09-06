# First Run

What to expect the first time you start Podlog.

## Model Download

On first boot, the worker downloads Whisper and pyannote model weights (~3 GB total). This happens once — models are cached in a Docker volume and persist across restarts.

During this phase:
- The worker logs will show download progress
- Jobs are queued but won't start processing until models are ready
- The queue page at `/queue` shows a banner saying the worker is downloading speech models until it is done; the download progress itself is in the worker logs

**Expected wait:** 5-15 minutes depending on your internet connection.

## Pulling the Ask AI Model

The model download above covers transcription and diarization. Ask AI uses a separate language model that nothing pulls for you:

```bash
make ollama-pull
```

Run it once, in parallel with the wait above if you like. It fetches the three models the Ask page offers, about 12 GB; `docker compose exec ollama ollama pull qwen2.5:3b` gets just the default (1.9 GB). Until one is pulled, the first question on `/ask` fails with "Model not available". If you configure Fireworks under Settings → Inference instead, skip this.

## Checking System Health

Once models are downloaded, all services should be healthy:

```bash
# Quick check from the terminal
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

You should see `"status": "OK"` for Database, Worker, Pipeline API, Ollama and Diarization (the last one confirms your HuggingFace token can download the pyannote model). Worker reports `WARMING_UP` until model downloads finish, and Ollama reports `DEGRADED` if its container is not reachable — in the local-first profile that is usually what holds the overall status below `OK`.

In the browser, the queue page at `/queue` will show stage counts and be ready to accept work.

## Settings Worth a Look on Day One

Everything works with the defaults. These are the four tabs of `/settings`, in the order they tend to matter:

1. **Inference** — local models by default. If you have a [Fireworks](19-inference-providers.md) key, this is where it goes, per pipeline step, with a **Test key** button. Decide this before your first big feed: switching later means re-processing to benefit.
2. **Notifications** — a Telegram bot or email tells you when episodes finish or fail, and the Telegram bot can also [answer commands](09-notifications.md#telegram-bot-commands) from your phone once you list your user id under **Allowed user IDs**.
3. **Backups** — nightly database dumps and audio snapshots are on by default; check the retention and where the files land. `make update` will refuse to run without a fresh dump, so keep this on.
4. **Prompts** — the system prompts behind Ask AI. Leave them until you have asked a few questions and know what you want changed.

## Adding Your First Feed

1. Open **Sources** from the navbar (http://localhost:3000/podcasts)
2. Click **Manage feeds** — this opens `/feeds`
3. Click **Add Feed**, paste an RSS feed URL
4. Choose **Test mode** — this ingests only the latest episode, so you get results fast
5. Click **Add**

**Tip:** Pick a podcast with short episodes (15-30 minutes) for your first test. A 30-minute episode takes roughly 45 minutes to fully process on an 8-core CPU.

## Or Upload Audio Manually

If you don't have an RSS feed handy, you can ingest local files directly:

1. Open **Sources** from the navbar
2. In **Manual uploads**, choose an audio file (`.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac`, `.opus`, `.aac`, `.wma`, `.webm`, `.mp4`)
3. Submit the upload and monitor progress from `/queue`

## Watching Progress

After adding a feed, go to `/queue` to watch the episode move through the pipeline:

1. **Pending** — waiting in queue
2. **Downloading** — fetching audio from the RSS feed
3. **Transcribing** — running Whisper speech-to-text
4. **Diarizing** — running pyannote speaker separation
5. **Chunking** — merging diarized segments into speaker-turn chunks for RAG
6. **Embedding** — generating vector embeddings for segments and chunks
7. **Inferring** — extracting speaker names via NER
8. **Archiving** — compressing audio to MP3
9. **Done**

For more detail on each stage and error handling, see [Queue Dashboard](08-queue.md).

Once the episode reaches **Done**, go to `/search` and search for something from the episode — you should see results with clickable timestamps.

---

**Next:** [Managing Feeds](03-feeds.md) | **Back:** [Installation](01-installation.md) | **Home:** [Guide](README.md)
