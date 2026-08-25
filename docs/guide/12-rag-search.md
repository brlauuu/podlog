# Ask AI (RAG Search)

Ask natural language questions and get answers drawn from your transcript library, powered by either local Ollama or Fireworks remote chat inference. Ask AI is live at `/ask`.

## How It Works

Instead of searching for keywords, you can ask questions like:

- "What arguments were made about carbon pricing across all episodes?"
- "Did anyone discuss the impact of remote work on team culture?"
- "Summarize what guests have said about AI regulation"

The system retrieves relevant transcript chunks via semantic search (pgvector), feeds them to a local LLM as context, and streams back a citation-backed answer with clickable timestamps linking to the source audio.

## Using Ask AI

1. Navigate to the **Ask** page from the navbar (or press <kbd>G</kbd> <kbd>A</kbd>)
2. Optionally narrow the search — see [Scoping a question](#scoping-a-question) below
3. Type your question in the input box
4. The answer streams in word-by-word with source citations
5. Click any citation timestamp to open the matching episode at that moment, using the same episode deep-link format as search results (`/episodes/{id}#t-<seconds>`)

## Scoping a question

Two filters sit above the question box, and both change which transcript chunks are retrieved before the model ever sees them.

**Podcast** — restrict retrieval to one or more feeds.

**Speaker** — restrict retrieval to passages a specific person actually spoke, across every podcast and episode.

The speaker filter matters more than it looks. Stored embeddings carry no speaker information, so an unscoped *"what did X say about Y"* retrieves whatever is most similar to Y regardless of who said it — and the model will then attribute those words to X. Scoping fixes that at the retrieval step.

The dropdown is populated from **names you have confirmed**, not raw `SPEAKER_00` labels or unconfirmed guesses, and it resolves through your renames rather than the per-episode diarization labels — so one person is matched correctly across episodes and feeds even though diarization numbers them differently every time. If a name is missing, confirm it on an episode page first; see [Speaker Management](06-speakers.md).

## Architecture

- **Provider-routed generation** — local [Ollama](https://ollama.ai) by default, optional Fireworks remote mode. Configured in **Settings → Inference → Pipeline Steps → RAG / Ask** via the dedicated `rag_provider` flag (Issue #608).
- **Local-first default** — no external API calls unless you explicitly flip the RAG step to remote. Enabling Fireworks for transcription does **not** silently route Ask through Fireworks.
- **Streaming responses** — answers appear word-by-word via server-sent events.
- **Model selection (local)** — `qwen2.5:3b` (default), `phi3:mini`, `gemma3n:e4b`. Each runs with a bounded `num_ctx` (8K–16K) for fast CPU prefill.
- **Model selection (remote)** — a curated list of Fireworks chat models: **OpenAI gpt-oss 20B** (fast), **OpenAI gpt-oss 120B** (balanced), **GLM 5.1** (quality). Pick one in Settings; the Ask page dropdown re-renders with the active provider's list and migrates a stale `localStorage` value automatically. Fireworks retires serverless models on a regular cadence, so this list moves — it lives in `apps/web/src/lib/rag-models.ts` and is the only place it needs changing.
- **Additional RAM:** ~2 GB when the local LLM is active (auto-unloaded when idle).

## Prerequisites

The Ask AI feature requires:
- Either:
  - local Ollama service running (`make up` profile), or
  - Fireworks remote mode for RAG configured in Settings → Inference → RAG / Ask (or `RAG_PROVIDER=fireworks` and `FIREWORKS_API_KEY` in `.env`)
- At least one episode fully processed through the embed stage (segments need vector embeddings)
- If using local mode: a pulled Ollama model (for example: `make ollama-pull`)

## Troubleshooting

- **"Ollama not available"** — Check that the ollama container is running: `docker compose ps ollama`
- **Slow first response** — The model loads into memory on first query; subsequent queries are faster
- **Model not available** — Pull the model first (`make ollama-pull`) or select one that already exists in Ollama
- **"Fireworks provider is not configured"** — Save a Fireworks API key in Settings or set `FIREWORKS_API_KEY` in `.env`
- **"Fireworks model '<path>' not found or not deployed"** — The configured chat model has been deprecated by Fireworks. Open Settings → Inference → RAG / Ask and pick a model from the curated dropdown.
- **Poor answer quality** — Try a larger model in the Ask page model selector, or ensure more episodes are processed so the retrieval pool is larger.

---

**Next:** [pyannote Cloud Diarization](13-pyannote-cloud.md) | **Back:** [Hardware & Performance](11-hardware.md) | **Home:** [Guide](README.md)
