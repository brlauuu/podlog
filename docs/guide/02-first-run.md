# First Run

What to expect the first time you start Podlog.

## Model Download

On first boot, the worker downloads Whisper and pyannote model weights (~3 GB total). This happens once — models are cached in a Docker volume and persist across restarts.

During this phase:
- The worker logs will show download progress
- Jobs are queued but won't start processing until models are ready
- The queue dashboard at `/queue` will stay focused on queue state; watch the worker logs for model download progress

**Expected wait:** 5-15 minutes depending on your internet connection.

## Checking System Health

Once models are downloaded, all services should be healthy:

```bash
# Quick check from the terminal
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

You should see `"status": "OK"` for Database, Worker, and Pipeline API.

In the browser, the queue page at `/queue` will show stage counts and be ready to accept work.

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
