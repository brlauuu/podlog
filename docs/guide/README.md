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
12. [Ask AI (RAG Search)](12-rag-search.md) — AI-powered Q&A over transcripts
13. [pyannote Cloud Diarization](13-pyannote-cloud.md) — Optional Precision-2 paid cloud provider
14. [Troubleshooting](14-troubleshooting.md) — Common issues and fixes

## Quick Start

If you just want to get running, head to [Installation](01-installation.md).

For the full project README, tech stack, and architecture diagram, see the [main README](../../README.md).
