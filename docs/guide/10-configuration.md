# Configuration

Podlog is configured via environment variables in `.env`. Only two are required (`POSTGRES_PASSWORD` and `HF_TOKEN`) — everything else has sensible defaults.

## Which Whisper Model Should I Pick?

The `WHISPER_MODEL` setting has the biggest impact on transcription quality, speed, and memory usage:

| Model | Peak RAM (Whisper) | Recommended system RAM | Speed | Quality |
|---|---|---|---|---|
| `large-v3-turbo` | ~6 GB | 12 GB+ | Fast | Near-best — **default, most users** |
| `medium` | ~5 GB | 12 GB | Moderate | Good |
| `small` | ~2 GB | 8 GB | Fast | Medium |
| `tiny` | ~1 GB | 4 GB | Very fast | Low — keyword search only |

Two columns, because they answer different questions. **Peak RAM** is what the Whisper model itself occupies. **Recommended system RAM** is what the machine should have in total, leaving headroom for PostgreSQL, Next.js, pyannote's ~2 GB during diarization, and the OS.

So on an 8 GB machine, `small` is the comfortable choice and `medium` will be tight; on 12 GB, `large-v3-turbo` is fine.

**To change models:** Edit `WHISPER_MODEL` in `.env`, then:
```bash
docker compose restart worker
```
New episodes use the new model. To re-transcribe existing episodes, use the Reprocess button on each episode page.

## Resource Tuning

| Setting | Default | When to Change |
|---|---|---|
| `WHISPER_BATCH_SIZE` | `16` | Reduce if you get OOM errors during transcription |
| `WHISPER_COMPUTE_TYPE` | `int8` | Change to `float32` for maximum accuracy (slower, more RAM) |
| `DISK_HEADROOM_BYTES` | 2 GB | Increase if your disk fills up between checks |
| `FEED_POLL_INTERVAL_HOURS` | `24` | Reduce for faster new-episode detection |
| `ARCHIVE_AUDIO` | `true` | Set `false` to skip audio archival and save disk space |
| `AUDIO_ARCHIVE_BITRATE` | `64k` | Increase to `128k` for higher audio quality |

## When Do Changes Take Effect?

- **Worker settings** (model, batch size, compute type): after `docker compose restart worker`
- **Feed poll interval**: after worker restart
- **Notification settings**: immediately (stored in database, not `.env`)
- **Existing episodes**: not affected — use Reprocess to re-transcribe with new settings

## Full Reference

For the complete list of all environment variables including retry logic, zombie detection, and speaker inference settings, see [docs/configuration.md](../configuration.md).

---

**Next:** [Hardware & Performance](11-hardware.md) | **Back:** [Notifications](09-notifications.md) | **Home:** [Guide](README.md)
