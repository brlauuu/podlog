# Podlog User Guide

Podlog is a self-hosted podcast transcription and search app. It downloads episodes from RSS feeds, transcribes them with Whisper, labels speakers with pyannote, and provides a web UI to search across all your transcripts.

Everything runs in Docker on your own machine. **Nothing leaves it** except RSS polling and one-time model downloads — no account, no telemetry, no per-request API calls. There is no remote-inference option: transcription, diarization, embeddings and Ask AI all run on your own hardware. Podlog once offered Fireworks AI and pyannote.ai as paid alternatives; they were removed in #1092, and an upgraded install switches itself back to local models on startup.

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
12. [Ask AI (RAG Search)](12-rag-search.md) — AI-powered Q&A over transcripts
14. [Meta-Analysis Dashboard](14-meta-analysis.md) — Cross-feed metrics and charts
15. [Database Exploration with Jupyter](15-explore.md) — Optional advanced: pandas + Plotly notebooks against the Podlog DB
16. [Backups](16-backups.md) — Daily DB + audio backups, retention, restore
17. [Troubleshooting](17-troubleshooting.md) — Common issues and fixes
18. [Keyboard Shortcuts](18-keyboard-shortcuts.md) — `J`/`K` episode nav, `/` focus search, `Space` / arrows for playback, `?` help overlay
20. [Updating](20-updating.md) — `make update`, channels, rollback, and the amd64-only note

## Ask about the docs

Every page of this guide has an **Ask about the docs** bubble in the bottom
corner of the web app. It answers questions about Podlog itself — how to
configure something, or why it works the way it does — drawing on this guide,
the reference documentation and the design documents, and it links to the exact
section each answer came from.

It is separate from [Ask AI](12-rag-search.md), which searches your podcast
transcripts. This one never looks at your episodes; that one never looks at the
documentation.

It uses the same local Ollama model as [Ask AI](12-rag-search.md) — whatever you
have set under **Settings → Inference** — so there is no separate setting to keep
in step. Only the handful of sections relevant to your question are sent to the
model, not the whole manual, which keeps it quick on a small model.

## Quick Start

If you just want to get running, head to [Installation](01-installation.md).

Prefer to watch first? Two short silent recordings live in [`docs/walkthroughs/`](../walkthroughs/README.md): a [fresh install](../walkthroughs/install.webm) (4 min) and [applying an update](../walkthroughs/update.webm) (2 min), made against v1.1.0.

For the full project README, tech stack, and architecture diagram, see the [main README](../../README.md).
