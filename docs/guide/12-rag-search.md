# Ask AI (RAG Search)

Ask natural language questions and get answers drawn from your transcript library, powered by a local LLM.

## How It Works

Instead of searching for keywords, you can ask questions like:

- "What arguments were made about carbon pricing across all episodes?"
- "Did anyone discuss the impact of remote work on team culture?"
- "Summarize what guests have said about AI regulation"

The system retrieves relevant transcript chunks via semantic search (pgvector), feeds them to a local LLM as context, and streams back a citation-backed answer with clickable timestamps linking to the source audio.

## Using Ask AI

1. Navigate to the **Ask** page from the navbar
2. Type your question in the input box
3. The answer streams in word-by-word with source citations
4. Click any citation timestamp to jump to that point in the audio

## Architecture

- **Fully local** — powered by [Ollama](https://ollama.ai) running in a Docker container
- **No external API calls** — your data never leaves your machine
- **Streaming responses** — answers appear word-by-word via server-sent events
- **Model selection** — configurable via `OLLAMA_MODEL` env var (default: see `.env.example`)
- **Additional RAM:** ~2 GB when the LLM is active (auto-unloaded when idle)

## Prerequisites

The Ask AI feature requires:
- The Ollama service running (included in `docker-compose.yml`)
- At least one episode fully processed through the embed stage (segments need vector embeddings)
- A pulled Ollama model (`make ollama-pull` or the worker pulls it automatically)

## Troubleshooting

- **"Ollama not available"** — Check that the ollama container is running: `docker compose ps ollama`
- **Slow first response** — The model loads into memory on first query; subsequent queries are faster
- **Poor answer quality** — Try a larger model via `OLLAMA_MODEL` in `.env`, or ensure more episodes are processed so the retrieval pool is larger

---

**Next:** [Troubleshooting](13-troubleshooting.md) | **Back:** [Hardware & Performance](11-hardware.md) | **Home:** [Guide](README.md)
