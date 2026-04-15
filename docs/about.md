# About Podlog

Podlog is a self-hosted podcast transcription and search application. It downloads episodes from RSS feeds, transcribes them locally using Whisper, identifies speakers with pyannote, and provides full-text and semantic search across all your transcripts.

Key features include sentence-level timestamps, a persistent audio player with clickable timestamps, semantic vector search powered by pgvector, and an AI-powered Ask feature for natural language queries about your podcasts.

Everything runs on your hardware. No audio leaves your machine, transcripts stay local, and no telemetry is collected. Optional remote inference via Fireworks AI is available.

> **Read more** — A blog post covering the motivation behind Podlog is coming soon.

## Credits

Built by [@brlauuu](https://github.com/brlauuu) with support from:

**Agents**

- [Claude](https://claude.ai) — Anthropic
- [Gemini](https://gemini.google.com) — Google
- [OpenCode](https://opencode.ai) — Kimi K2.5

**Platforms**

- [Omnara](https://omnara.cc)
- [Fireworks AI](https://fireworks.ai) (optional remote inference)

[brlauuu/podlog](https://github.com/brlauuu/podlog) · [O'Saasy License](https://osaasy.dev)

## Built with

[WhisperX](https://github.com/m-bain/whisperX) · [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [pyannote](https://github.com/pyannote/pyannote-audio) · [Next.js](https://nextjs.org) · [PostgreSQL](https://www.postgresql.org) · [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com)

## Privacy

All data stays on your machine. Audio files, transcripts, and embeddings are stored locally. No external APIs are called during transcription or search. The only outbound requests are RSS feed fetches to download episode metadata and audio.

## Disclaimer

This software is an open-source tool for audio transcription. It does not include any copyrighted content. Users are responsible for ensuring their use of the software complies with local copyright laws and the Terms of Service of any content creators whose work they process.
