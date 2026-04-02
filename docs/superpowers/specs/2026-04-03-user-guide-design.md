# User Guide Design Spec

**Issue:** #101
**Date:** 2026-04-03
**Scope:** In-repo guide at `docs/guide/`, linked from README. Wiki and in-app wizard are out of scope (wizard tracked in #108).

---

## Structure

```
docs/guide/
├── README.md                    # Table of contents + "What is Podlog?"
├── 01-installation.md           # Prerequisites, .env, build & start
├── 02-first-run.md              # Model download, warmup, adding first feed
├── 03-feeds.md                  # Feed modes, management, promotion
├── 04-search.md                 # FTS operators, semantic search, export
├── 05-episodes.md               # Transcript view, speaker labels, reprocessing
├── 06-speakers.md               # Renaming, merging, AI inference
├── 07-audio-playback.md         # Persistent player, timestamp linking
├── 08-queue.md                  # Pipeline stages, errors, retries, stuck
├── 09-notifications.md          # Telegram, email (Postfix/SMTP), frequency
├── 10-configuration.md          # Model selection, resource tuning
├── 11-hardware.md               # Benchmarks, storage estimates
├── 12-rag-search.md             # Placeholder for #90
└── 13-troubleshooting.md        # Common issues and fixes
```

## Page Format

Every page follows the same template:

```markdown
# Page Title

Brief intro (1-2 sentences explaining what this covers).

## Content sections...

---

**Next:** [Next Page Title](next-page.md) | **Back:** [Prev Page Title](prev-page.md) | **Home:** [Guide](README.md)
```

- Cross-link related pages inline (e.g., queue page links to troubleshooting for error handling)
- No duplication of `docs/configuration.md` or `docs/hardware.md` — narrative wrapper with links to full reference
- Screenshot placeholders as `<!-- screenshot: description -->` comments — can be filled in later

## Content Per Page

### README.md — Table of Contents
- One-paragraph "What is Podlog?" (self-hosted, local, privacy-first)
- Numbered list of guide pages with one-line descriptions
- "Quick start" shortcut linking to installation page
- Link back to main project README

### 01-installation.md
- System requirements summary (CPU, RAM, disk) with link to `docs/hardware.md`
- Prerequisites: Docker + Compose V2, HuggingFace account + token, pyannote license acceptance
- Step-by-step: clone, `.env` setup (only POSTGRES_PASSWORD and HF_TOKEN required), `make build && make up`
- What the services are (5 containers, no Redis/Celery)
- Common commands: `make up`, `make down`, `make logs`, `make shell-db`

### 02-first-run.md
- What happens on first boot: model download (~3 GB), warmup phase
- How to tell when ready: `/queue` shows "Ready", health endpoint returns OK
- Adding your first feed: recommend test mode with a short-episode podcast
- Watching the queue: what the stages mean at a high level (detail in 08-queue.md)

### 03-feeds.md
- Three modes with use cases:
  - **Test** — 1 episode, trial before committing
  - **Selective** — pick specific episodes from large catalogs
  - **Full** — all episodes + auto-poll
- Adding a feed walkthrough
- Promoting test/selective to full
- Polling: manual refresh vs automatic (configurable interval)
- Deleting a feed (option to keep or remove episodes)

### 04-search.md
- Full-text search operators: `"phrase"`, `OR`, `-exclude`, `prefix*`
- Semantic search: what it does, when it helps (conceptual queries vs exact keywords)
- Grouped vs flat view
- Feed filter
- Export: Markdown, plain text, PDF
- Search URL is bookmarkable (`?q=...`)

### 05-episodes.md
- Episode detail page: metadata, transcript, speaker labels
- Timestamp format and clickable playback
- Speaker badges: AI-inferred vs user-confirmed
- Reprocessing: when and why (model upgrade, config change)
- Diarization/inference failure banners — what they mean

### 06-speakers.md
- Automatic labeling: how pyannote assigns SPEAKER_00, SPEAKER_01, etc.
- AI inference: spaCy NER extracts names, shows as "inferred" badge
- Renaming: click speaker name to edit, marks as user-confirmed
- Merging: select multiple speakers, merge into one target
- When diarization fails: transcript still usable, no speaker labels

### 07-audio-playback.md
- Persistent player: fixed to bottom, survives page navigation
- Controls: play/pause, seek, volume, skip +/-15s
- Timestamp linking: click timestamp in transcript to play from that point
- URL hash navigation: `/episodes/{id}#t-120`
- When audio isn't available: `ARCHIVE_AUDIO=false` or external RSS fallback

### 08-queue.md
- Pipeline stages: pending -> downloading -> transcribing -> diarizing -> inferring -> archiving -> done
- Stage bar and filtering in the UI
- Error classification:
  - Transient (auto-retry): TRANSIENT_NETWORK, HTTP_ACCESS
  - Fatal (manual): DISK_FULL, OOM
  - SYSTEM_ERROR: unexpected, retryable
- Stuck episodes: what causes them, how they appear
- Retry: which errors are retryable, how to retry from UI
- Zombie detection: jobs exceeding timeout automatically marked failed

### 09-notifications.md
- **Telegram setup:**
  1. Create bot via @BotFather, copy token
  2. Start chat with bot, send any message
  3. Get chat ID via `getUpdates` API
  4. Enter token + chat ID in `/notifications`
  5. Click "Send test message"

- **Email setup — three paths:**
  - **Local Postfix (Linux):**
    - `sudo apt install postfix`, choose "Internet Site"
    - Add Docker subnet: `sudo postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'`
    - `sudo systemctl reload postfix`
    - Default SMTP settings work (`host.docker.internal:25`, no TLS)
  - **External SMTP (Gmail, Fastmail, etc.):**
    - Set SMTP host, port 587, TLS enabled, username + app password
    - Gmail requires 2FA + app password
  - **Docker mailserver:**
    - Mention as option, link to docker-mailserver project

- **Frequency options:** immediate (per-episode), daily digest, weekly digest
- **Deliverability note:** direct-from-localhost emails may land in spam; suggest external SMTP for reliability

### 10-configuration.md
- Narrative guide: "Which model should I pick?"
  - `large-v3-turbo` (default, best balance)
  - `medium` for 8 GB machines
  - `small` for 4 GB machines
- Resource tuning: batch size, disk headroom, zombie timeout
- Link to `docs/configuration.md` for full env var reference
- Changes take effect on worker restart + episode reprocessing

### 11-hardware.md
- Narrative guide: "How long will my episodes take?"
- Processing time rules of thumb by machine class
- Storage calculator: episodes x avg duration -> disk needed
- Model size vs quality vs speed table
- Link to `docs/hardware.md` for full benchmarks

### 12-rag-search.md
- "Coming soon" placeholder
- What it will do: natural language questions answered by local LLM
- Link to #90 for details and planning
- Note: fully local via Ollama, no external API calls

### 13-troubleshooting.md
- Model download slow/stuck on first run
- OOM errors -> reduce model size
- Diarization failed -> transcript still usable
- Disk full -> archive settings
- Timestamps not clickable -> audio not archived
- Email not sending -> Postfix mynetworks, host.docker.internal
- Search returns nothing -> check if episodes are done processing
- Queue shows 0 active -> should be fixed by #98, but mention as historical note

## README Update

Add one line to the Documentation table in the main README:

```markdown
| [User Guide](docs/guide/) | Step-by-step guide for new users: setup, features, configuration |
```

## Out of Scope

- Screenshots (added later as the UI stabilizes)
- In-app wizard (#108)
- Video tutorials
- Translations
