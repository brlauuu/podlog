# RAG Search (Coming Soon)

A future feature that will let you ask natural language questions and get answers drawn from your transcript library.

## What It Will Do

Instead of searching for keywords, you'll be able to ask questions like:

- "What arguments were made about carbon pricing across all episodes?"
- "Did anyone discuss the impact of remote work on team culture?"
- "Summarize what guests have said about AI regulation"

The system will retrieve relevant transcript excerpts, feed them to a local LLM, and return a citation-backed answer with clickable timestamps linking to the source audio.

## How It Will Work

- **Fully local** — powered by [Ollama](https://ollama.ai) running on your machine
- **No external API calls** — your data never leaves your computer
- **Streaming responses** — answers appear word-by-word instead of waiting 20-30 seconds for a full response
- **Model selection** — choose between faster (Qwen2.5-1.5B) and higher quality (Qwen2.5-3B) models
- **Additional RAM:** ~2 GB when the LLM is active (auto-unloaded when idle)

## Status

This feature is being planned in [issue #90](https://github.com/brlauuu/podlog/issues/90). The embedding pipeline (a prerequisite) is already in place — all transcript segments are embedded with all-MiniLM-L6-v2 vectors stored in pgvector.

---

**Next:** [Troubleshooting](13-troubleshooting.md) | **Back:** [Hardware & Performance](11-hardware.md) | **Home:** [Guide](README.md)
