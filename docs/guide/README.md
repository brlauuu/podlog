# Podlog User Guide

Podlog is a self-hosted podcast transcription and search app. It downloads episodes from RSS feeds, transcribes them with Whisper, labels speakers with pyannote, and provides a web UI to search across all your transcripts.

Everything runs in Docker on your own machine. **In the default configuration nothing leaves it** except RSS polling and one-time model downloads — no account, no telemetry, no per-request API calls. Remote inference is available if your hardware is the bottleneck: transcription via Fireworks AI, diarization via pyannote.ai, and Ask AI generation via Fireworks. All three are opt-in, off by default, and independent of each other — see [Inference Providers](19-inference-providers.md).

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
13. [pyannote Cloud Diarization](13-pyannote-cloud.md) — Optional Precision-2 paid cloud provider
14. [Meta-Analysis Dashboard](14-meta-analysis.md) — Cross-feed metrics and charts
15. [Database Exploration with Jupyter](15-explore.md) — Optional advanced: pandas + Plotly notebooks against the Podlog DB
16. [Backups](16-backups.md) — Daily DB + audio backups, retention, restore
17. [Troubleshooting](17-troubleshooting.md) — Common issues and fixes
18. [Keyboard Shortcuts](18-keyboard-shortcuts.md) — `J`/`K` episode nav, `/` focus search, `Space` / arrows for playback, `?` help overlay
19. [Inference Providers](19-inference-providers.md) — Local vs remote choices for transcription + diarization, decision matrix, and providers we evaluated but didn't ship

## Ask about the docs

Every page of this guide has an **Ask about the docs** bubble in the bottom
corner of the web app. It answers questions about Podlog itself — how to
configure something, or why it works the way it does — drawing on this guide,
the reference documentation and the design documents, and it links to the exact
section each answer came from.

It is separate from [Ask AI](12-rag-search.md), which searches your podcast
transcripts. This one never looks at your episodes; that one never looks at the
documentation.

It uses the same provider and model as [Ask AI](12-rag-search.md) — whatever you
have set under **Settings → Inference**. Switching that between local inference
and Fireworks switches this too; there is no separate setting to keep in step.
Only the handful of sections relevant to your question are sent to the model, not
the whole manual, so it works on a local-only install.

## Quick Start

If you just want to get running, head to [Installation](01-installation.md).

For the full project README, tech stack, and architecture diagram, see the [main README](../../README.md).
