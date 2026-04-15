# About Podlog

Podlog is a self-hosted application for turning podcast audio into a searchable, browsable knowledge base. It polls RSS feeds (or accepts manual uploads), transcribes episodes with Whisper, separates speakers with pyannote, and then lets you search every spoken word with full-text and semantic search — or ask natural-language questions over the whole archive.

Everything runs on your own hardware, inside Docker. There is no cloud account to create, no API to call at runtime, and no telemetry. The only outbound traffic in default mode is RSS polling and one-time model downloads. An optional Fireworks AI mode exists for users who would rather not run inference locally, and is strictly opt-in.

## What you get

- **Full transcripts** with sentence-level timestamps and speaker labels.
- **Hybrid search** that mixes PostgreSQL full-text search with pgvector similarity search, so "electric cars" finds segments that talk about Tesla or batteries even when those exact words never appear.
- **Ask AI** — a RAG interface over the transcript library powered by a local Ollama model (default) or Fireworks (optional), streaming citation-backed answers with clickable source timestamps.
- **Persistent audio player** that follows you across pages so you can read a passage and immediately hear the original audio.
- **Queue dashboard** with per-stage status, error classification, and automatic retries for transient failures.
- **Speaker management** — automatic labels from pyannote, name suggestions from spaCy NER, and a web UI to rename or merge speakers.
- **Notifications** on Telegram or email when episodes finish processing, with optional daily or weekly digest mode.

## Privacy

Audio, transcripts, embeddings, and speaker data all stay on your machine. Whisper, pyannote, sentence-transformers, and Ollama run locally. Nothing about what you listen to or search for leaves the box unless you explicitly enable a remote provider.

## Credits

Built by [@brlauuu](https://github.com/brlauuu) with help from:

**Agents**

- [Claude](https://claude.ai) — Anthropic
- [Gemini](https://gemini.google.com) — Google
- [OpenCode](https://opencode.ai) — Kimi K2.5

**Platforms**

- [Omnara](https://omnara.cc)
- [Fireworks AI](https://fireworks.ai) — optional remote inference

## Built on

[WhisperX](https://github.com/m-bain/whisperX) · [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [pyannote](https://github.com/pyannote/pyannote-audio) · [sentence-transformers](https://www.sbert.net/) · [Ollama](https://ollama.ai) · [Next.js](https://nextjs.org) · [FastAPI](https://fastapi.tiangolo.com) · [PostgreSQL](https://www.postgresql.org) + [pgvector](https://github.com/pgvector/pgvector) · [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com)

[brlauuu/podlog](https://github.com/brlauuu/podlog) · [O'Saasy License](https://osaasy.dev)

## Disclaimer

Podlog is an open-source tool for audio transcription. It does not include or distribute any copyrighted content. You are responsible for ensuring your use of the software complies with local copyright laws and the Terms of Service of any content creators whose work you process.
