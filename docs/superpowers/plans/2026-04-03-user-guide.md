# User Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a comprehensive in-repo user guide at `docs/guide/` covering installation through troubleshooting, and link it from the main README.

**Architecture:** 14 markdown files (README + 13 topic pages) in `docs/guide/`. Each page follows a consistent template with nav footer. Pages reference but don't duplicate `docs/configuration.md` and `docs/hardware.md`. Screenshot placeholders as HTML comments for later.

**Tech Stack:** Markdown only. No code changes except one line added to the main README.

**Spec:** `docs/superpowers/specs/2026-04-03-user-guide-design.md`

---

## Page Template

Every page uses this structure. The nav footer links are filled per-page.

```markdown
# Title

Brief intro (1-2 sentences).

## Sections...

---

**Next:** [Title](file.md) | **Back:** [Title](file.md) | **Home:** [Guide](README.md)
```

---

### Task 1: Guide README (table of contents)

**Files:**
- Create: `docs/guide/README.md`

- [ ] **Step 1: Write `docs/guide/README.md`**

```markdown
# Podlog User Guide

Podlog is a self-hosted podcast transcription and search app. It downloads episodes from RSS feeds, transcribes them with Whisper, labels speakers with pyannote, and provides a web UI to search across all your transcripts. Everything runs locally in Docker — no cloud dependencies, no external API calls, all data stays on your machine.

## Contents

1. [Installation](01-installation.md) — Prerequisites, configuration, and starting the stack
2. [First Run](02-first-run.md) — What happens on first boot and adding your first podcast
3. [Managing Feeds](03-feeds.md) — Feed modes, adding, promoting, and deleting feeds
4. [Search](04-search.md) — Full-text and semantic search, operators, export
5. [Episodes & Transcripts](05-episodes.md) — Reading transcripts, speaker labels, reprocessing
6. [Speaker Management](06-speakers.md) — Renaming, merging, and AI-inferred names
7. [Audio Playback](07-audio-playback.md) — Persistent player, timestamp linking
8. [Queue Dashboard](08-queue.md) — Pipeline stages, errors, retries, stuck episodes
9. [Notifications](09-notifications.md) — Telegram and email setup, frequency options
10. [Configuration](10-configuration.md) — Model selection and resource tuning
11. [Hardware & Performance](11-hardware.md) — Processing times, storage estimates
12. [RAG Search](12-rag-search.md) — AI-powered Q&A over transcripts (coming soon)
13. [Troubleshooting](13-troubleshooting.md) — Common issues and fixes

## Quick Start

If you just want to get running, head to [Installation](01-installation.md).

For the full project README, tech stack, and architecture diagram, see the [main README](../../README.md).
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/README.md
git commit -m "docs(guide): add table of contents (#101)"
```

---

### Task 2: Installation page

**Files:**
- Create: `docs/guide/01-installation.md`

- [ ] **Step 1: Write `docs/guide/01-installation.md`**

```markdown
# Installation

Get Podlog running on your machine in about 5 minutes.

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB+ |
| Disk | 15 GB free | 20 GB+ |
| GPU | Not required | Not required |

Podlog runs entirely on CPU. For detailed benchmarks and storage estimates by library size, see [Hardware & Performance](11-hardware.md).

## Prerequisites

1. **Docker** with **Compose V2** — [install Docker](https://docs.docker.com/get-docker/)
   ```bash
   docker compose version   # verify
   ```

2. **HuggingFace account** — [create one](https://huggingface.co/join) (free), then [generate an access token](https://huggingface.co/settings/tokens) (read access is sufficient)

3. **Accept the pyannote license** — visit [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and click "Agree and access repository." Without this, speaker diarization will silently fail.

## Setup

```bash
# Clone the repo
git clone https://github.com/brlauuu/podlog.git
cd podlog

# Create your config file
cp .env.example .env
```

Edit `.env` and set the two required variables:

```bash
POSTGRES_PASSWORD=choose-a-strong-password
HF_TOKEN=hf_your_token_here
```

Everything else has sensible defaults. See [Configuration](10-configuration.md) for tuning options.

## Build and Start

```bash
make build    # Build Docker images (first time takes a few minutes)
make up       # Start all services in the background
```

Open **http://localhost:3000** — you should see the Podlog search page.

## What's Running

Podlog starts 5 containers:

| Service | Port | Role |
|---|---|---|
| **web** | 3000 | Next.js frontend — search, episodes, queue |
| **pipeline** | 8000 | FastAPI control plane — feed management, health |
| **worker** | — | Processes episodes: download, transcribe, diarize, archive |
| **db** | 5432 | PostgreSQL 15 with pgvector for FTS + semantic search |

No Redis, no Celery — the job queue is PostgreSQL-backed.

## Common Commands

```bash
make up          # Start all services
make down        # Stop all services
make build       # Rebuild Docker images
make logs        # Follow logs for all services
make shell-db    # Open a psql shell
make test-unit   # Run unit tests
make help        # List all available commands
```

---

**Next:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/01-installation.md
git commit -m "docs(guide): add installation page (#101)"
```

---

### Task 3: First Run page

**Files:**
- Create: `docs/guide/02-first-run.md`

- [ ] **Step 1: Write `docs/guide/02-first-run.md`**

```markdown
# First Run

What to expect the first time you start Podlog.

## Model Download

On first boot, the worker downloads Whisper and pyannote model weights (~3 GB total). This happens once — models are cached in a Docker volume and persist across restarts.

During this phase:
- The worker logs will show download progress
- Jobs are queued but won't start processing until models are ready
- The queue dashboard at `/queue` may show a "Warming up" banner

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

1. Go to **http://localhost:3000/feeds**
2. Click **Add Feed**
3. Paste an RSS feed URL
4. Choose **Test mode** — this ingests only the latest episode, so you get results fast
5. Click **Add**

**Tip:** Pick a podcast with short episodes (15-30 minutes) for your first test. A 30-minute episode takes roughly 45 minutes to fully process on an 8-core CPU.

## Watching Progress

After adding a feed, go to `/queue` to watch the episode move through the pipeline:

1. **Pending** — waiting in queue
2. **Downloading** — fetching audio from the RSS feed
3. **Transcribing** — running Whisper speech-to-text
4. **Diarizing** — running pyannote speaker separation
5. **Inferring** — extracting speaker names via NER
6. **Archiving** — compressing audio to MP3
7. **Done**

For more detail on each stage and error handling, see [Queue Dashboard](08-queue.md).

Once the episode reaches **Done**, go to `/` and search for something from the episode — you should see results with clickable timestamps.

---

**Next:** [Managing Feeds](03-feeds.md) | **Back:** [Installation](01-installation.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/02-first-run.md
git commit -m "docs(guide): add first run page (#101)"
```

---

### Task 4: Feeds page

**Files:**
- Create: `docs/guide/03-feeds.md`

- [ ] **Step 1: Write `docs/guide/03-feeds.md`**

```markdown
# Managing Feeds

Podlog organizes content by RSS feed. Each feed represents one podcast.

## Feed Modes

When adding a feed, you choose how many episodes to ingest:

| Mode | Episodes Ingested | Auto-Poll | Use Case |
|---|---|---|---|
| **Test** | 1 (latest only) | Yes | Try a feed before committing to the full back-catalog |
| **Selective** | You pick which ones | Yes | Large back-catalogs where you only want specific episodes |
| **Full** | All episodes | Yes | Normal subscription — ingest everything and keep up to date |

All modes auto-poll for new episodes (default: every 24 hours, configurable via `FEED_POLL_INTERVAL_HOURS`).

## Adding a Feed

1. Go to `/feeds` and click **Add Feed**
2. Paste the RSS feed URL
3. Choose a mode:
   - **Test** — click Add, the latest episode is queued immediately
   - **Selective** — click Next to see a list of all episodes, check the ones you want, then Add
   - **Full** — click Add, all episodes are queued

## Promoting a Feed

You can upgrade a feed's mode at any time:

- **Test → Full**: click **Promote to Full** on the feed card. All remaining episodes are queued for processing.
- **Selective → Full**: same button. Episodes you didn't select initially are now queued.

Promotion never re-processes episodes that are already done.

## Polling for New Episodes

- **Automatic:** The worker checks all feeds every 24 hours (configurable). New episodes are queued automatically.
- **Manual:** Click the refresh icon on any feed card to poll immediately.

Manual polling is useful when you know a new episode just dropped and don't want to wait for the next automatic poll.

## Deleting a Feed

Click the delete button on a feed card. You'll be asked whether to also delete the feed's episodes and transcripts, or keep them.

- **Keep episodes:** Transcripts remain searchable, but no new episodes will be ingested.
- **Delete episodes:** All transcripts, segments, and archived audio for that feed are removed.

---

**Next:** [Search](04-search.md) | **Back:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/03-feeds.md
git commit -m "docs(guide): add feeds page (#101)"
```

---

### Task 5: Search page

**Files:**
- Create: `docs/guide/04-search.md`

- [ ] **Step 1: Write `docs/guide/04-search.md`**

```markdown
# Search

Podlog provides hybrid search combining full-text keyword matching with semantic vector search.

## Full-Text Search

Type keywords into the search bar on the home page (`/`). Podlog supports these operators:

| Operator | Example | Matches |
|---|---|---|
| Keywords | `climate change` | Segments containing both words |
| Exact phrase | `"carbon neutral"` | Exact phrase only |
| OR | `renewable OR solar` | Either term |
| Exclude | `emissions -diesel` | "emissions" but not "diesel" |
| Prefix | `econ*` | Words starting with "econ" (economics, economy, etc.) |

Operators can be combined: `"machine learning" OR deep -neural`.

## Semantic Search

In addition to keyword matching, Podlog uses vector embeddings (all-MiniLM-L6-v2 via pgvector) to find semantically similar content. This means:

- Searching `electric cars` can find segments about EVs, Tesla, or battery vehicles — even if those exact words aren't used
- Conceptual queries work better than with keywords alone
- Results are ranked by a combination of keyword relevance and semantic similarity

## View Modes

- **Grouped** (default): Results grouped by podcast, then by episode. Good for browsing.
- **Flat**: Individual segment results with pagination. Good for finding a specific quote.

Toggle between views using the buttons above the results.

## Filtering by Podcast

Use the feed filter dropdown to narrow results to a specific podcast. Useful when you remember which show discussed a topic but not which episode.

## Exporting Results

Click the download button to export search results:

- **Markdown** — full text with structure preserved
- **Plain text** — compact, no formatting
- **PDF** — print-friendly layout (opens print dialog)

## Bookmarkable URLs

Search URLs include the query as `?q=...`, so you can bookmark or share a search.

---

**Next:** [Episodes & Transcripts](05-episodes.md) | **Back:** [Managing Feeds](03-feeds.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/04-search.md
git commit -m "docs(guide): add search page (#101)"
```

---

### Task 6: Episodes and Speakers pages

**Files:**
- Create: `docs/guide/05-episodes.md`
- Create: `docs/guide/06-speakers.md`

- [ ] **Step 1: Write `docs/guide/05-episodes.md`**

```markdown
# Episodes & Transcripts

Each processed episode has a detail page showing its full transcript with speaker labels and timestamps.

## Episode Detail Page

Navigate to any episode from search results, the podcast page, or the queue. The episode page shows:

- **Metadata**: title, publication date, duration, processing times
- **Podcast context**: feed title, artwork
- **Transcript**: the full text organized by speaker turns with timestamps

## Reading the Transcript

The transcript is displayed as a series of speaker-labeled sections. Each section shows:

- **Speaker name** (or label like SPEAKER_00 if not yet named) with a colored badge
- **Timestamp** — the start time of that segment, clickable to play audio
- **Text** — the transcribed speech

Speaker badges indicate the name source:
- No badge: user-confirmed name
- "AI" badge: name inferred by spaCy NER (see [Speaker Management](06-speakers.md))

## Clickable Timestamps

Click any timestamp to start audio playback from that point. The persistent player at the bottom of the screen loads the episode's audio and seeks to the clicked position. See [Audio Playback](07-audio-playback.md) for details.

## Reprocessing an Episode

If you change your Whisper model, compute type, or other processing settings, existing episodes aren't automatically re-transcribed. To reprocess:

1. Open the episode detail page
2. Click **Reprocess**
3. The episode is re-queued through the full pipeline

This deletes the existing transcript and segments, then re-downloads, re-transcribes, and re-diarizes from scratch.

## Status Banners

You may see banners at the top of an episode page:

- **"Diarization failed"** — pyannote couldn't label speakers (noisy audio, etc.), but the transcript is still usable. Speaker labels will be missing.
- **"Speaker inference unavailable"** — spaCy NER couldn't extract speaker names. You can still rename speakers manually.

---

**Next:** [Speaker Management](06-speakers.md) | **Back:** [Search](04-search.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Write `docs/guide/06-speakers.md`**

```markdown
# Speaker Management

Podlog automatically labels speakers in each episode and offers tools to rename and merge them.

## Automatic Speaker Labeling

After transcription, pyannote analyzes the audio to detect different speakers. Each speaker is assigned a label: `SPEAKER_00`, `SPEAKER_01`, etc. These labels are consistent within an episode but not across episodes (the same person may be SPEAKER_00 in one episode and SPEAKER_01 in another).

## AI-Inferred Names

If `INFERENCE_ENABLED=true` (the default), Podlog runs spaCy named entity recognition on each speaker's text to guess their name. For example, if SPEAKER_00 says "I'm Dr. Smith and today we're discussing...", the system may infer the name "Dr. Smith."

Inferred names show an "AI" badge to distinguish them from user-confirmed names. They're a starting point — override them if they're wrong.

## Renaming a Speaker

1. On the episode detail page, click any speaker name
2. Type the correct name
3. The name is saved immediately and marked as user-confirmed

User-confirmed names take priority over AI-inferred names and won't be overwritten by future inference runs.

## Merging Speakers

Sometimes pyannote splits one real speaker into multiple labels (e.g., SPEAKER_00 and SPEAKER_02 are both the host). To fix this:

1. On the episode detail page, open the speaker panel
2. Select the speakers you want to merge (checkboxes)
3. Choose the target speaker (the one to keep)
4. Click **Merge**

All segments from the source speakers are reassigned to the target. The merge is atomic — it either fully completes or doesn't change anything.

## When Diarization Fails

If pyannote can't process the audio (too noisy, unsupported language, etc.), the episode is still transcribed — you just won't have speaker labels. The transcript shows all text without speaker separation.

In this case, renaming and merging are unavailable since there are no speaker labels to work with.

---

**Next:** [Audio Playback](07-audio-playback.md) | **Back:** [Episodes & Transcripts](05-episodes.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/05-episodes.md docs/guide/06-speakers.md
git commit -m "docs(guide): add episodes and speakers pages (#101)"
```

---

### Task 7: Audio Playback and Queue pages

**Files:**
- Create: `docs/guide/07-audio-playback.md`
- Create: `docs/guide/08-queue.md`

- [ ] **Step 1: Write `docs/guide/07-audio-playback.md`**

```markdown
# Audio Playback

Podlog includes a persistent audio player for listening to episodes alongside their transcripts.

## The Player

The audio player is fixed to the bottom of the screen. Once you start playing an episode, the player persists across page navigation — you can search, browse other episodes, or check the queue without interrupting playback.

**Controls:**
- Play/pause
- Seek bar (click to jump to any position)
- Current time / total duration
- Volume control and mute toggle
- Skip forward/backward 15 seconds

## Playing from Timestamps

The primary way to use the player is by clicking timestamps in a transcript:

1. Open any episode with a completed transcript
2. Click a timestamp (e.g., `12:34`)
3. The player loads the episode's audio and seeks to that moment

This lets you read a transcript and instantly hear the original audio for any section.

## Direct Links

Episode URLs support a timestamp hash for direct linking:

```
http://localhost:3000/episodes/{id}#t-120
```

This opens the episode and auto-scrolls to the segment nearest 120 seconds. Combined with a timestamp click, it also starts playback. These URLs are bookmarkable and shareable.

Search result timestamps include this hash, so clicking a search result takes you directly to the relevant moment.

## When Audio Isn't Available

Audio playback requires the episode's audio to be archived locally. If audio isn't available:

- **`ARCHIVE_AUDIO=false`**: Audio is deleted after transcription to save disk. Transcripts are still fully searchable, but playback is unavailable.
- **Audio not yet archived**: The episode may still be processing. Check the [Queue](08-queue.md).

---

**Next:** [Queue Dashboard](08-queue.md) | **Back:** [Speaker Management](06-speakers.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Write `docs/guide/08-queue.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/07-audio-playback.md docs/guide/08-queue.md
git commit -m "docs(guide): add audio playback and queue pages (#101)"
```

---

### Task 8: Notifications page

**Files:**
- Create: `docs/guide/09-notifications.md`

- [ ] **Step 1: Write `docs/guide/09-notifications.md`**

```markdown
# Notifications

Podlog can send notifications when episodes finish processing or fail. Two channels are supported: Telegram and email. Configure either or both from the `/notifications` page in the web UI.

## Telegram Setup

1. **Create a bot:** Open Telegram and search for **@BotFather**. Send `/newbot` and follow the prompts. Copy the **bot token** (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

2. **Get your chat ID:** Start a chat with your new bot and send it any message. Then visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Find `"chat":{"id":123456789}` in the response — that number is your **Chat ID**.

3. **Configure in Podlog:** Go to `/notifications`, open the Telegram tab, enter your bot token and chat ID, and click **Save**.

4. **Test:** Click **Send test message**. You should receive a message from your bot in Telegram.

## Email Setup

Email notifications require an SMTP server that the Podlog containers can reach. Three common approaches:

### Option A: Local Postfix (Linux)

The simplest option if you're running Podlog on a Linux machine.

1. **Install Postfix:**
   ```bash
   sudo apt install postfix
   ```
   During setup, choose **"Internet Site"** to send directly to recipients.

2. **Allow Docker containers to relay through Postfix:**
   ```bash
   sudo postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'
   sudo systemctl reload postfix
   ```
   This adds the Docker bridge network to Postfix's trusted networks.

3. **Configure in Podlog:** Go to `/notifications`, open the Email tab. The default SMTP settings (`host.docker.internal` port `25`, no TLS) work with local Postfix. Just enter your recipient email address and click **Save**.

4. **Test:** Click **Send test email**.

> **Deliverability note:** Emails sent directly from a home machine (no SPF/DKIM, residential IP) often land in spam at Gmail, Outlook, ProtonMail, etc. This is fine for self-notifications, but check your spam folder. For better deliverability, use an external SMTP provider (Option B).

### Option B: External SMTP (Gmail, Fastmail, etc.)

Use an existing email provider's SMTP server for reliable delivery.

1. **Gmail example:**
   - Enable 2-Factor Authentication on your Google account
   - Go to Google Account > Security > App passwords, create one for "Mail"
   - In Podlog `/notifications` > Email > SMTP Configuration:
     - Host: `smtp.gmail.com`
     - Port: `587`
     - Username: `your.email@gmail.com`
     - Password: the app password you created
     - TLS: enabled

2. **Other providers:** Check your provider's SMTP documentation for host, port, and TLS settings.

### Option C: Docker Mailserver

For a self-contained setup without installing anything on the host, you can run a mail server as another Docker container. [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver) is a popular option. Configuration details are beyond the scope of this guide — refer to their documentation.

## Notification Frequency

Configure how often you receive success notifications (failures are always sent immediately):

| Frequency | Behavior |
|---|---|
| **Immediate** | One notification per completed episode |
| **Daily digest** | Summary of all completed episodes, sent at 8:00 AM UTC |
| **Weekly digest** | Summary sent Monday at 8:00 AM UTC |

Set the frequency on the **General** tab in `/notifications`.

## Environment Variables

Notifications can also be configured via `.env` instead of the web UI. Values set in the UI override `.env` values. See [Configuration](10-configuration.md) for the full list.

---

**Next:** [Configuration](10-configuration.md) | **Back:** [Queue Dashboard](08-queue.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/09-notifications.md
git commit -m "docs(guide): add notifications page (#101)"
```

---

### Task 9: Configuration and Hardware pages

**Files:**
- Create: `docs/guide/10-configuration.md`
- Create: `docs/guide/11-hardware.md`

- [ ] **Step 1: Write `docs/guide/10-configuration.md`**

```markdown
# Configuration

Podlog is configured via environment variables in `.env`. Only two are required (`POSTGRES_PASSWORD` and `HF_TOKEN`) — everything else has sensible defaults.

## Which Whisper Model Should I Pick?

The `WHISPER_MODEL` setting has the biggest impact on transcription quality, speed, and memory usage:

| Model | RAM Needed | Speed | Quality | Best For |
|---|---|---|---|---|
| `large-v3-turbo` | 12 GB+ | Fast | Near-best | **Most users (default)** |
| `medium` | 12 GB | Moderate | Good | 8 GB machines |
| `small` | 8 GB | Fast | Medium | 4 GB machines, quick testing |
| `tiny` | 4 GB | Very fast | Low | Keyword search only |

The "RAM Needed" column is the recommended total system RAM, not just what Whisper uses. The system needs headroom for PostgreSQL, Next.js, and the OS.

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
```

- [ ] **Step 2: Write `docs/guide/11-hardware.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/10-configuration.md docs/guide/11-hardware.md
git commit -m "docs(guide): add configuration and hardware pages (#101)"
```

---

### Task 10: RAG placeholder and Troubleshooting pages

**Files:**
- Create: `docs/guide/12-rag-search.md`
- Create: `docs/guide/13-troubleshooting.md`

- [ ] **Step 1: Write `docs/guide/12-rag-search.md`**

```markdown
# RAG Search (Coming Soon)

A future feature that will let you ask natural language questions and get answers drawn from your transcript library.

## What It Will Do

Instead of searching for keywords, you'll be able to ask questions like:

- "What arguments were made about carbon pricing across all episodes?"
- "Did anyone discuss the impact of remote work on team culture?"
- "Summarize what guests have said about AI regulation"

The system will retrieve relevant transcript excerpts, feed them to a local LLM, and return a citation-backed answer with clickable timestamps linking to the source audio.

## How It Will Work

- **Fully local** — powered by [Ollama](https://ollama.ai) running on your machine
- **No external API calls** — your data never leaves your computer
- **Streaming responses** — answers appear word-by-word instead of waiting 20-30 seconds for a full response
- **Model selection** — choose between faster (Qwen2.5-1.5B) and higher quality (Qwen2.5-3B) models
- **Additional RAM:** ~2 GB when the LLM is active (auto-unloaded when idle)

## Status

This feature is being planned in [issue #90](https://github.com/brlauuu/podlog/issues/90). The embedding pipeline (a prerequisite) is already in place — all transcript segments are embedded with all-MiniLM-L6-v2 vectors stored in pgvector.

---

**Next:** [Troubleshooting](13-troubleshooting.md) | **Back:** [Hardware & Performance](11-hardware.md) | **Home:** [Guide](README.md)
```

- [ ] **Step 2: Write `docs/guide/13-troubleshooting.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/12-rag-search.md docs/guide/13-troubleshooting.md
git commit -m "docs(guide): add RAG placeholder and troubleshooting pages (#101)"
```

---

### Task 11: Update main README

**Files:**
- Modify: `README.md` (Documentation table, approximately line 109-113)

- [ ] **Step 1: Add guide link to README Documentation table**

In `README.md`, find the Documentation table:

```markdown
## Documentation

| Document | Description |
|---|---|
| [Configuration](docs/configuration.md) | All environment variables with defaults and explanations |
| [Hardware Guide](docs/hardware.md) | System requirements, processing benchmarks, tested machine specs |
| [Development](docs/development.md) | Local development setup, running tests, project structure |
```

Add a new row at the top of the table body:

```markdown
| [User Guide](docs/guide/) | Step-by-step guide for new users: setup, features, configuration |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: link user guide from README (#101)"
```

---

### Task 12: Final review and PR

- [ ] **Step 1: Verify all files exist**

```bash
ls docs/guide/
```

Expected: `README.md`, `01-installation.md` through `13-troubleshooting.md` (14 files).

- [ ] **Step 2: Verify all internal links work**

```bash
# Check that every markdown link target exists
grep -ohP '\]\(([^)]+\.md)\)' docs/guide/*.md | tr -d '](/)' | sort -u | while read f; do
  [ -f "docs/guide/$f" ] || echo "BROKEN: $f"
done
```

Expected: no output (all links valid).

- [ ] **Step 3: Create PR**

```bash
git push -u origin 101-user-guide
gh pr create --title "docs: add comprehensive user guide" --body "$(cat <<'EOF'
## Summary
- Adds `docs/guide/` with 14 pages covering installation through troubleshooting
- Linked from main README Documentation table
- Key addition: notification email setup (Postfix, external SMTP, Docker mailserver)
- RAG search placeholder for #90

## Pages
1. Table of contents (README)
2. Installation
3. First run
4. Feed management
5. Search
6. Episodes & transcripts
7. Speaker management
8. Audio playback
9. Queue dashboard
10. Notifications (Telegram + email with Postfix guide)
11. Configuration
12. Hardware & performance
13. RAG search (coming soon)
14. Troubleshooting

Closes #101

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
