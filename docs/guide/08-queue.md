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
| **Chunking** | Merging diarized segments into speaker-turn chunks for RAG |
| **Embedding** | Generating vector embeddings for segments and chunks |
| **Inferring** | Extracting speaker names via spaCy NER |
| **Archiving** | Compressing audio to MP3 and writing transcript file |
| **Done** | Fully processed and searchable |

Episodes are processed sequentially (one at a time) to avoid running out of memory. Later pipeline stages are prioritized — an episode already in progress finishes before new ones start.

## The Stage Bar

The colored bar at the top of the queue page shows counts per stage, and clicking a segment filters the list to just those episodes. Every stage in the table above has its own segment, so you can watch an episode move across the bar from Pending through to Done.

## Error Classification

When an episode fails, the error is classified. The class determines what the queue offers you:

| Error Class | Retry | What Happened |
|---|---|---|
| `TRANSIENT_NETWORK` | Automatic | Network timeout, DNS failure, or a 429/5xx from a provider |
| `HTTP_ACCESS` | Depends — see below | An HTTP 4xx response |
| `SYSTEM_ERROR` | Manual | Unexpected error, or a job killed by the zombie detector |
| `DISK_FULL` | None | Not enough free disk space — free space first |
| `OOM` | None | Out of memory — reduce model size or add RAM |
| `MANUAL_UPLOAD_FILE_MISSING` | None | An uploaded file is no longer on disk — re-upload it |
| `NO_SPEECH` | None | Transcription produced nothing because the audio contains no speech |

**Auto-retry** is decided by whether the failure is judged transient, not by the class name alone. Transient failures retry up to 3 times with exponential backoff (30s, 60s, 120s), configurable via `RETRY_MAX` and `RETRY_BACKOFF_BASE`.

`HTTP_ACCESS` sits on both sides of that line. A 403 or 404 on a podcast's audio URL is treated as terminal — the file isn't going to appear on the fourth attempt, so failing fast saves bandwidth and tells you something real about the feed. The same class raised by Fireworks or pyannote.ai *is* retried, because those services return 4xx for conditions that do clear.

**Manual retry:** click the **Retry** button on a failed episode to re-queue it. The button is hidden for `DISK_FULL`, `OOM`, `MANUAL_UPLOAD_FILE_MISSING` and `NO_SPEECH` — retrying any of those reaches the identical outcome — and the pipeline rejects the request server-side too.

## Episodes With No Speech

If transcription finds no speech at all, the episode ends in its own terminal state rather than being reported as a failure. Nothing malfunctioned: the download, transcription and diarization all worked and correctly reported silence. No failure notification is sent and no retry is offered.

They are listed with completed episodes under **Done**, badged **NO SPEECH** in amber so you can tell them apart at a glance, and they carry the same tag on their own episode page. They count towards the Done total, because as far as the pipeline is concerned they are finished — there was simply nothing to index.

## Stuck Episodes

An episode may appear as **Stuck** if it's not in a done/failed state but has no active job in the queue. This can happen if:

- A job was interrupted by a container restart
- The worker hit an unhandled error

Stuck episodes are visible in the queue UI under the "Stuck" filter. They can be reprocessed from the episode detail page. The worker also sweeps for stranded episodes periodically and re-enqueues them.

## Zombie Detection

The worker monitors running jobs and marks them as failed if they exceed expected processing time (configurable via `ZOMBIE_TIMEOUT_MULTIPLIER` and `ZOMBIE_REALTIME_FACTOR`). This catches jobs that stall due to OOM kills or container issues. Zombie jobs are marked as `SYSTEM_ERROR` and can be retried.

---

**Next:** [Notifications](09-notifications.md) | **Back:** [Audio Playback](07-audio-playback.md) | **Home:** [Guide](README.md)
