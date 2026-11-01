# Ask AI (RAG Search)

Ask natural language questions and get answers drawn from your transcript library, powered by a local Ollama model. Ask AI is live at `/ask`.

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

- **Local generation** — answers come from [Ollama](https://ollama.ai) on your own machine; retrieved transcript chunks never leave it. The default model is set under **Settings → Inference**.
- **Streaming responses** — answers appear word-by-word via server-sent events.
- **Model selection** — `qwen2.5:3b` (default), `phi3:mini`, `gemma3n:e4b`. Each runs with a bounded `num_ctx` (8K–16K) for fast CPU prefill. The list lives in `apps/web/src/lib/rag-models.ts`.
- **Additional RAM:** ~2 GB when the local LLM is active (auto-unloaded when idle).

## Asking from Telegram

With bot commands enabled and your Telegram account on the allowed list (see [Notifications](09-notifications.md#telegram-bot-commands)), `/ask <question>` runs the same retrieval and generation from a Telegram chat, with the configured default model and no feed scope. The reply streams into a single message that the bot keeps editing, and ends with the sources. One question is answered at a time.

## Prerequisites

The Ask AI feature requires:
- The `ollama` service running (part of the default stack)
- At least one episode fully processed through the embed stage (segments need vector embeddings)
- A pulled Ollama model (for example: `make ollama-pull`)

## Troubleshooting

- **"Ollama not available"** — Check that the ollama container is running: `docker compose ps ollama`
- **Slow first response** — The model loads into memory on first query; subsequent queries are faster
- **Model not available** — Pull the model first (`make ollama-pull`) or select one that already exists in Ollama
- **Poor answer quality** — Try a larger model in the Ask page model selector, or ensure more episodes are processed so the retrieval pool is larger.

---

**Next:** [Database Exploration with Jupyter](15-explore.md) | **Back:** [Hardware & Performance](11-hardware.md) | **Home:** [Guide](README.md)
