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
from app.services.rag import (
    DEFAULT_MODEL,
    build_prompt,
    check_model_available,
    chunks_to_sources,
    retrieve_chunks,
    stream_ollama_response,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str
    model: str | None = None
    feed_id: str | None = None


def _sse_event(event: str, data: dict | str) -> str:
    payload = json.dumps(data) if isinstance(data, dict) else data
    return f"event: {event}\ndata: {payload}\n\n"


async def _stream_ask(question: str, model: str, feed_id: str | None):
    db = SessionLocal()
    try:
        # 1. Retrieve relevant chunks
        chunks = retrieve_chunks(db, question, feed_id=feed_id)

        if not chunks:
            yield _sse_event("error", {"message": "No relevant transcript excerpts found for your question."})
            yield _sse_event("done", {})
            return

        # 2. Send sources first
        sources = chunks_to_sources(chunks)
        yield _sse_event("sources", sources)

        # 3. Build prompt and stream response
        messages = build_prompt(question, chunks)

        async for token in stream_ollama_response(messages, model=model):
            yield _sse_event("token", {"content": token})

        yield _sse_event("done", {})

    except Exception as exc:
        logger.error(
            '"action": "ask_error", "question": "%s", "error": "%s"',
            question[:100],
            str(exc),
        )
        yield _sse_event("error", {"message": f"Error generating answer: {type(exc).__name__}"})
        yield _sse_event("done", {})
    finally:
        db.close()


@router.post("/ask")
async def ask_endpoint(req: AskRequest):
    model = req.model or DEFAULT_MODEL

    # Validate model availability
    if not await check_model_available(model):
        return StreamingResponse(
            iter([_sse_event("error", {"message": f"Model '{model}' is not available. Run: make ollama-pull"}),
                  _sse_event("done", {})]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return StreamingResponse(
        _stream_ask(req.question, model, req.feed_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
