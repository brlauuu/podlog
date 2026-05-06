"""
POST /api/ask — RAG endpoint with SSE streaming (issue #116).

Retrieves relevant transcript chunks, builds a citation-aware prompt,
and streams the LLM response from Ollama as Server-Sent Events.

SSE event types:
  sources  — retrieved chunks (sent first)
  token    — streamed LLM token
  error    — error message
  done     — stream complete
"""
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.database import SessionLocal
from app.services.notification_settings import get_runtime_inference_settings
from app.services.prompts import get_prompt
from app.services.rag import (
    DEFAULT_MODEL,
    build_prompt,
    check_model_available,
    chunks_to_sources,
    retrieve_chunks,
    stream_response,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str
    model: str | None = None
    feed_id: str | None = None
    feed_ids: list[str] | None = None
    episode_id: str | None = None
    speaker_label: str | None = None


def _sse_event(event: str, data: dict | list | str) -> str:
    payload = json.dumps(data) if isinstance(data, (dict, list)) else data
    return f"event: {event}\ndata: {payload}\n\n"


async def _stream_ask(question: str, model: str | None, feed_ids: list[str] | None, episode_id: str | None = None, speaker_label: str | None = None):
    db = SessionLocal()
    try:
        runtime = get_runtime_inference_settings(db)
        # Issue #608: RAG/Ask routing reads its own dedicated provider flag,
        # decoupled from inference_provider (which controls transcription).
        provider = runtime.get("rag_provider") or "local"
        # Issue #637: when the caller doesn't supply a model, fall back to the
        # admin-configured rag_local_model (local) or fireworks_chat_model
        # (fireworks), then to the hardcoded DEFAULT_MODEL.
        if provider == "local":
            resolved_model = model or runtime.get("rag_local_model") or DEFAULT_MODEL
        else:
            resolved_model = model or DEFAULT_MODEL
        if provider == "fireworks" and not (
            isinstance(resolved_model, str) and resolved_model.startswith("accounts/")
        ):
            # Caller sent an Ollama-style name (legacy dropdown shipped only
            # Ollama models pre-#608). Fall back to the configured Fireworks
            # chat model. PR 3 makes the Ask page send valid Fireworks paths
            # directly.
            resolved_model = runtime.get("fireworks_chat_model") or resolved_model

        if provider == "local" and not await check_model_available(resolved_model, runtime=runtime):
            yield _sse_event(
                "error",
                {"message": f"Model '{resolved_model}' is not available. Run: make ollama-pull"},
            )
            yield _sse_event("done", {})
            return
        if provider == "fireworks" and not runtime.get("fireworks_api_key"):
            yield _sse_event(
                "error",
                {"message": "Fireworks provider is not configured. Save FIREWORKS_API_KEY first."},
            )
            yield _sse_event("done", {})
            return

        # 1. Retrieve relevant chunks
        chunks = retrieve_chunks(db, question, feed_ids=feed_ids, episode_id=episode_id, speaker_label=speaker_label)

        if not chunks:
            yield _sse_event("error", {"message": "No relevant transcript excerpts found for your question."})
            yield _sse_event("done", {})
            return

        # 2. Send sources first
        sources = chunks_to_sources(chunks)
        yield _sse_event("sources", sources)

        # 3. Build prompt and stream response. Issue #643: per-episode Ask
        # popup and the global /ask page get separate, user-editable system
        # prompts (defaulting to the same text).
        prompt_key = "ask_episode_system" if episode_id else "ask_page_system"
        system_prompt = get_prompt(db, prompt_key)
        messages = build_prompt(question, chunks, system_prompt=system_prompt)

        async for token in stream_response(messages, model=resolved_model, runtime=runtime):
            yield _sse_event("token", {"content": token})

        yield _sse_event("done", {})

    except Exception as exc:
        error_str = str(exc) or type(exc).__name__
        logger.error(
            '"action": "ask_error", "question": "%s", "error": "%s (%s)"',
            question[:100],
            error_str,
            type(exc).__name__,
        )
        detail = error_str.split("\n")[0][:200]
        yield _sse_event("error", {"message": f"Error generating answer: {detail}"})
        yield _sse_event("done", {})
    finally:
        db.close()


@router.post("/ask")
async def ask_endpoint(req: AskRequest):
    # Support both feed_ids (multi-select) and legacy feed_id (single)
    feed_ids = req.feed_ids
    if not feed_ids and req.feed_id:
        feed_ids = [req.feed_id]

    return StreamingResponse(
        _stream_ask(req.question, req.model, feed_ids, episode_id=req.episode_id, speaker_label=req.speaker_label),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
