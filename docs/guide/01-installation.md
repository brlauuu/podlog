# Installation

Get Podlog running on your machine in about 5 minutes.

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core or more |
| RAM | 8 GB | 16 GB+ |
| Disk | 30 GB free | 80 GB+ |
| GPU | Not required | Not required |

Podlog runs entirely on CPU.

**The disk figure is mostly machine-learning weight, not your audio.** Ollama is 8.4 GB, the worker image carries the full ML stack at 7.1 GB, and the downloaded models add ~5.7 GB — about 25 GB before you ingest a single episode. Archived audio then costs roughly 29 MB per hour at the default bitrate, so a 1,000-hour library lands near 58 GB all in. For measured numbers and storage by library size, see [Hardware & Performance](11-hardware.md).

## Prerequisites

1. **Docker** with **Compose V2** — [install Docker](https://docs.docker.com/get-docker/)
   ```bash
   docker compose version   # verify
   ```

2. **HuggingFace account** — [create one](https://huggingface.co/join) (free), then [generate an access token](https://huggingface.co/settings/tokens) (read access is sufficient)

3. **Accept the pyannote license** — visit [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) and click "Agree and access repository." Without this, speaker diarization will silently fail. (If you override `PYANNOTE_MODEL` to a different pyannote release, accept the license for that model instead.)

4. **PostgreSQL client tools** (optional, for health monitoring) — needed by the host-level health check script:
   ```bash
   # Ubuntu/Debian
   sudo apt install postgresql-client

   # macOS
   brew install libpq
   ```

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

If you want remote Fireworks inference mode, also set:

```bash
FIREWORKS_API_KEY=fw_your_key_here
```

## Build and Start

```bash
make build    # Build Docker images (first time takes a few minutes)
make up       # Start all services in the background
```

`make up` prints where to reach Podlog when it finishes:

```
Podlog is running.
  This machine:  http://localhost:3000
  Same network:  http://192.168.1.190:3000
```

Open **http://localhost:3000** — you should see the Podlog home page with quick links to Search and Ask. The search page itself is at `/search`.

### Starting from a published image instead

`make build` compiles everything from source, which pulls several gigabytes of
machine-learning dependencies and takes a while the first time. If you would
rather run a released build:

```bash
make up-release   # pull the published images and start, no build
```

Which build you get is set by `PODLOG_VERSION` in `.env`:

| Value | Meaning |
|---|---|
| `stable` | the newest release (default) |
| `edge` | current `main`, rebuilt on every merge |
| `0.10.0` | an exact version — also how you downgrade |

The images are **linux/amd64 only**. On any other architecture, building from
source is the supported path.

### Updating

```bash
make update                  # move to the newest release
make update VERSION=0.10.0   # pin an exact version, or go back to one
```

`make update` drains the queue, takes a database backup and refuses to
continue without one, moves, pulls, restarts, and prints the exact restore
command if anything fails. See [Updating](20-updating.md) for what each step
protects against, channels, rollback and the amd64-only note.

`make up` and `make up-release` are deliberately separate: `make up` never
contacts the registry, so it always runs the code in your working copy, even
after you have edited it. `make up-release` never builds, so it cannot
surprise you with a multi-gigabyte compile.

The "same network" address is the one to use from a phone or another computer. Read the [Security model](#security-model) below before you use it: anyone who can reach that address has full control, with no login. If no LAN address is shown, either your machine has no network route or you have bound the web service to loopback — either way Podlog is reachable from this machine only.

The address comes from DHCP and can change when your router or machine restarts. Reserve it in your router if you want it stable.

### Optional: Remote-Inference Profile

Use this when you want Fireworks-backed inference and no local Ollama container:

```bash
make up-remote
```

This runs `docker compose -f docker-compose.yml -f docker-compose.remote.yml up -d`.

## What's Running

Podlog starts these containers by profile:

| Profile | Services |
|---|---|
| **Local-first (`make up`)** | `web`, `pipeline`, `worker`, `db`, `ollama`, `backup` |
| **Remote-inference (`make up-remote`)** | `web`, `pipeline`, `worker`, `db`, `backup` (no `ollama`) |
| **Explore (opt-in, `make explore`)** | adds `explore` (Jupyter) to whichever profile is running |

Service details:

| Service | Port | Reachable from | Role |
|---|---|---|---|
| **web** | 3000 | your network | Next.js frontend — home, search, episodes, queue, Ask |
| **pipeline** | 8000 | this machine only | FastAPI control plane — feed management, health |
| **worker** | — | — | Processes episodes: download, transcribe, diarize, chunk, embed, infer, archive |
| **db** | 5432 | this machine only | PostgreSQL 15 with pgvector for FTS + semantic search |
| **ollama** | 11434 | this machine only | Local Ask AI generation provider (local-first profile) |
| **backup** | — | — | Nightly DB dump + audio archive snapshot into `./backups/` (see [Backups](16-backups.md)) |

No Redis, no Celery — the job queue is PostgreSQL-backed.

## Security model

Podlog assumes it runs on **one machine, and one network, that you trust**. Read this before changing how it is deployed.

**The web interface is the only thing exposed to your network.** You can open Podlog from a phone or another computer. The database, the pipeline API and Ollama are bound to `127.0.0.1` and are reachable only from the machine Podlog runs on.

**But that web interface is not a read-only viewer.** There is no login, and it forwards writes to the pipeline API on your behalf. Anyone who can open port 3000 — every device on your Wi-Fi, guests included — has **full control of Podlog**. They can:

- add, edit and delete feeds
- delete episodes and their transcripts
- **delete your backups**, both database dumps and audio snapshots
- upload audio, trigger re-processing, and change every setting

Your API keys are masked when read back, so those are not handed out directly. Everything else is fair game.

**The pipeline API has no authentication.** Anything able to reach port 8000 can do all of the above directly. Port 8000 itself is bound to the host — but because the web app proxies to it without authenticating, the effective trust boundary is your **network**, not just the machine.

**If you are on a shared, office or guest network,** treat that as the deciding fact. To opt out of LAN access entirely, bind the web service to loopback in `docker-compose.yml`:

```yaml
  web:
    ports:
      - "127.0.0.1:3000:3000"   # this machine only
```

Podlog then behaves like the other services: reachable over an SSH tunnel or from the host, and from nowhere else.

The remaining boundary is doing real work, so two changes would break it:

- **Do not re-publish port 8000, 5432 or 11434 to `0.0.0.0`.** The `ports:` entries in `docker-compose.yml` are deliberately `127.0.0.1:`-prefixed. Removing that prefix puts an unauthenticated write API, or your database, on your local network.
- **Do not move the `web` container to a different host** without putting authentication in front of the pipeline API first. `web` reaches it over the private Docker network; splitting them means exposing it.

If you need either, treat adding authentication as a prerequisite rather than a follow-up. See [issue #960](https://github.com/brlauuu/podlog/issues/960) for the options that were considered.

**Your API keys live in `.env`** — Fireworks, pyannote, Telegram, SMTP. It is gitignored. The settings API masks them on read, but anyone who can read the file has them outright.

## Common Commands

```bash
make up              # Start all services
make up-remote       # Start Fireworks remote-inference profile
make down            # Stop all services
make down-remote     # Stop Fireworks remote-inference profile
make build           # Rebuild Docker images
make logs            # Follow logs for all services
make logs-remote     # Follow logs for remote-inference profile
make shell-db        # Open a psql shell
make test-unit       # Run pipeline unit tests + healthcheck script tests
make health-install  # Install health monitoring cron job (every 15 min)
make health-check    # Run health check once (manual)
make help            # List all available commands
```

---

**Next:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
