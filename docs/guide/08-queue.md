# Queue Dashboard

The queue page at `/queue` shows the processing status of all episodes.

## Pipeline Stages

Every episode moves through these stages in order:

| Stage | What Happens |
|---|---|
| **Pending** | Waiting in queue for the worker to pick it up |
| **Downloading** | Fetching audio from the RSS feed URL |
| **Transcribing** | Running Whisper speech-to-text |
| **Diarizing** | Running pyannote speaker separation |
| **Inferring** | Extracting speaker names via spaCy NER |
| **Archiving** | Compressing audio to MP3 and writing transcript file |
| **Done** | Fully processed and searchable |

Episodes are processed sequentially (one at a time) to avoid running out of memory. Later pipeline stages are prioritized — an episode already in progress finishes before new ones start.

## The Stage Bar

The colored bar at the top of the queue page shows counts for each stage. Click any stage to filter the list to just those episodes.

## Error Classification

When an episode fails, the error is classified to determine whether it can be retried:

| Error Class | Retryable | What Happened |
|---|---|---|
| `TRANSIENT_NETWORK` | Yes (auto) | Network timeout or DNS failure during download |
| `HTTP_ACCESS` | Yes (auto) | HTTP 403/404 on the audio URL |
| `SYSTEM_ERROR` | Yes (manual) | Unexpected error or zombie timeout |
| `DISK_FULL` | No | Not enough free disk space — free space first |
| `OOM` | No | Out of memory — reduce model size or add RAM |

**Auto-retry:** Transient errors retry automatically up to 3 times with exponential backoff (30s, 60s, 120s).

**Manual retry:** Click the **Retry** button on a failed episode to re-queue it. Non-retryable errors (DISK_FULL, OOM) show a message explaining what to fix first.

## Stuck Episodes

An episode may appear as **Stuck** if it's not in a done/failed state but has no active job in the queue. This can happen if:

- A job was interrupted by a container restart
- The worker hit an unhandled error

Stuck episodes are visible in the queue UI under the "Stuck" filter. They can be reprocessed from the episode detail page.

## Zombie Detection

The worker monitors running jobs and marks them as failed if they exceed expected processing time (configurable via `ZOMBIE_TIMEOUT_MULTIPLIER` and `ZOMBIE_REALTIME_FACTOR`). This catches jobs that stall due to OOM kills or container issues. Zombie jobs are marked as `SYSTEM_ERROR` and can be retried.

---

**Next:** [Notifications](09-notifications.md) | **Back:** [Audio Playback](07-audio-playback.md) | **Home:** [Guide](README.md)
