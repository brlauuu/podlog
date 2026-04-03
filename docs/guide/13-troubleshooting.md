# Troubleshooting

Common issues and how to fix them.

## Worker stuck on first run

**Symptom:** Queue shows no activity, worker logs show download progress.

**Cause:** The worker is downloading Whisper and pyannote models (~3 GB). This is normal and happens only once.

**Fix:** Wait 5-15 minutes. Check progress with `make logs`. Models are cached in a Docker volume and won't re-download on future restarts.

## Out of Memory (OOM) errors

**Symptom:** Episodes fail with `error_class=OOM`.

**Cause:** The Whisper model doesn't fit in available RAM.

**Fix:** Use a smaller model:
```bash
# Edit .env
WHISPER_MODEL=medium    # or small, tiny

# Restart the worker
docker compose restart worker
```

Then retry the failed episode from the queue page. See [Configuration](10-configuration.md) for model RAM requirements.

## Diarization failed

**Symptom:** Episode page shows "Diarization failed" banner. No speaker labels.

**Cause:** pyannote couldn't process the audio — common with very noisy recordings, music-heavy content, or unsupported languages.

**Impact:** The transcript is still fully searchable. Speaker labels and renaming/merging are unavailable for that episode.

**Fix:** No action needed. If you want to retry, click **Reprocess** on the episode page.

## Disk full

**Symptom:** Episodes fail with `error_class=DISK_FULL`.

**Cause:** Less than 2 GB free disk space (configurable via `DISK_HEADROOM_BYTES`).

**Fix:**
- Free disk space, then retry the episode
- Reduce archive size: set `AUDIO_ARCHIVE_BITRATE=32k` in `.env`
- Disable archival: set `ARCHIVE_AUDIO=false` (transcripts still work, no playback)

## Timestamps not clickable

**Symptom:** Clicking a timestamp in a transcript does nothing.

**Cause:** Audio isn't archived locally.

**Fix:** Check if `ARCHIVE_AUDIO=true` in `.env`. If it was previously `false`, existing episodes won't have audio — reprocess them to download and archive.

## Email notifications not sending

**Symptom:** "Send test email" fails or returns an error.

**Common causes:**

1. **`Name or service not known`** — the Docker container can't reach the mail server. Check that `docker-compose.yml` includes `extra_hosts: host.docker.internal:host-gateway` for the pipeline service (added in PR #103).

2. **`Relay access denied`** — Postfix isn't allowing relay from Docker. Add the Docker subnet to `mynetworks`:
   ```bash
   sudo postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'
   sudo systemctl reload postfix
   ```

3. **Email lands in spam** — normal for direct-from-localhost delivery. Check your spam folder, or use an external SMTP provider for better deliverability.

See [Notifications](09-notifications.md) for full setup instructions.

## Search returns no results

**Symptom:** Searching returns nothing even though you've added feeds.

**Possible causes:**

1. **Episodes still processing** — check the [Queue](08-queue.md) page. Episodes aren't searchable until they reach Done.
2. **No matching content** — try broader search terms or different keywords.
3. **Embeddings not generated** — semantic search requires embeddings. Check `make shell-db` then `SELECT COUNT(*) FROM segments WHERE embedding IS NOT NULL;`

## Queue shows 0 active while worker is processing

**Symptom:** The queue page shows no active jobs, but the worker logs show it's working.

**Cause:** This was a known issue (fixed in PR #99) where the queue API read from `episodes.status` instead of the `job_queue` table. If you're seeing this, make sure you're running the latest version:

```bash
git pull origin main
make build
docker compose up -d web
```

---

**Back:** [RAG Search](12-rag-search.md) | **Home:** [Guide](README.md)
