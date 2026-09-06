# Walkthrough recordings

Two short recordings of the moments that decide whether someone keeps using Podlog: the **first install** and the **first update**. They are made against a throwaway install, scripted so they can be redone after a release that changes either flow, and kept small enough to live in the repository.

| Recording | Made against | Files |
|---|---|---|
| Fresh install | v1.1.0 | `install.webm` (terminal + browser), `install.cast` (terminal only, text) |
| Applying an update | v1.0.1 → v1.1.0 | `update.webm`, `update.cast` |

The `.webm` files play in the GitHub file viewer and upload to YouTube as they are. The `.cast` files are [asciinema](https://asciinema.org) recordings: a few kilobytes of text, searchable, and playable with `asciinema play install.cast`.

Both recordings are silent; the narration lines are printed on screen by the scripts. Nothing on screen is a secret: the `.env` edits are shown masked.

## What the install recording shows

1. Prerequisites: Docker with Compose v2, a HuggingFace token, the pyannote licence accepted on HuggingFace. The licence is the step people skip, and since 1.1.0 the queue page tells you when it is missing.
2. `git clone`, checkout of the newest tag, `cp .env.example .env`, the two required values, `make up-release`, and the access banner it prints.
3. The invisible wait: the worker downloads about 3 GB of models. `/api/health` reports the worker as `WARMING_UP` and the queue page shows a banner until it is done.
4. `docker compose exec ollama ollama pull qwen2.5:3b`, the local model Ask AI needs, which nothing pulls for you.
5. In the browser: the empty home page, the queue page with the warm-up banner, the four Settings tabs in the order worth visiting on day one (Inference, Notifications, Prompts, Backups), the first feed added in Test mode, the episode moving through the queue, the finished episode page, one search, one Ask question.

Not shown: the Telegram bot. A phone is needed for that, and the bot's commands are documented in [Notifications](../guide/09-notifications.md#telegram-bot-commands).

## What the update recording shows

1. An install one release behind, with a processed episode, so the drain and the backup have something to protect.
2. How you learn an update exists: by default nothing tells you; `UPDATE_CHECK_ENABLED=true` adds a footer link.
3. `make update`, step by step as it prints them: the clean working copy check, draining the queue, the backup it refuses to continue without, the move to the new tag, the pull, the configuration drift report, the restart, and the closing line with the rollback command.
4. In the browser: the footer version and the release notes at the bottom of `/about`.

## Redoing the recordings

Everything runs from the repository root. You need `asciinema` and `agg` on the host (`pip install --user asciinema`; `agg` is a single binary from its GitHub releases); ffmpeg runs inside the worker image.

A second Podlog can sit next to a running one: the scripts move the host ports when `WEB_PORT` is set, Compose names the project after the directory, and the volumes follow the project name. Do **not** give the throwaway install your Telegram bot token: Telegram allows one consumer per token, and two installs polling it would both log conflicts.

```bash
mkdir -p docs/walkthroughs/out

# 1. Fresh install (terminal), then the browser half against it.
PODLOG_DIR=~/podlog-fresh HF_TOKEN=$HF_TOKEN WEB_PORT=3001 API_PORT=8001 \
  asciinema rec -c "bash docs/walkthroughs/install.sh" docs/walkthroughs/out/install.cast
BASE_URL=http://localhost:3001 SCENARIO=install OUT=docs/walkthroughs/out \
  node docs/walkthroughs/browser.mjs

# 2. Update: start from an install one release behind with an episode done
#    (install the previous tag with PODLOG_VERSION=<prev> make up-release,
#    add a feed, wait), then:
PODLOG_DIR=~/podlog-fresh API_PORT=8001 \
  asciinema rec -c "bash docs/walkthroughs/update.sh" docs/walkthroughs/out/update.cast
BASE_URL=http://localhost:3001 SCENARIO=update OUT=docs/walkthroughs/out \
  node docs/walkthroughs/browser.mjs

# 3. Render: casts -> WebM, join with the browser halves.
bash docs/walkthroughs/render.sh docs/walkthroughs/out
```

`browser.mjs probe` walks every page read-only and reports whether the selectors it relies on still exist; run it first after a UI change. `PACE=0` removes the pauses for dry runs.

The feed used is NPR News Now (`https://feeds.npr.org/500005/podcast.xml`), chosen because its episodes are five minutes long, so a Test-mode add finishes processing in minutes rather than an hour.

## Keeping them honest

The recordings show the app as it is, not as it should be. When a recording stops matching the app, either the app drifted or the recording is stale; redo the recording after the release that changed the flow, and note the version in the table above.
