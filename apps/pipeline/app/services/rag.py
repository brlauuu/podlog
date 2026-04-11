"""
RAG retrieval and prompt construction for the /api/ask endpoint (issue #116).

Retrieves relevant transcript chunks by embedding similarity, builds a
citation-aware prompt, and streams the LLM response from Ollama.
"""
import json
import logging
from dataclasses import dataclass

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.services.embed import embed_query
from app.services.notification_settings import get_runtime_embedding_settings

logger = logging.getLogger(__name__)

TOP_K = 8
SIMILARITY_THRESHOLD = 0.3
DEFAULT_MODEL = "qwen2.5:3b"

SYSTEM_PROMPT = """You are a helpful assistant that answers questions about podcast transcripts.

RULES:
- Answer ONLY based on the provided transcript excerpts below.
- If the excerpts don't contain enough information, say so clearly.
- Cite your sources using the format [Episode Title, MM:SS] after each claim.
- Be concise and direct."""


@dataclass
class ChunkResult:
    chunk_id: int
    episode_id: str
    episode_title: str
    speaker_label: str | None
    start_time: float
    end_time: float
    text: str
    similarity: float
    audio_local_path: str | None = None


def retrieve_chunks(
    db: Session,
    question: str,
    top_k: int = TOP_K,
    feed_ids: list[str] | None = None,
    episode_id: str | None = None,
    speaker_label: str | None = None,
) -> list[ChunkResult]:
    """Retrieve top-K chunks by cosine similarity to the question embedding."""
    runtime = get_runtime_embedding_settings(db)
    embedding = embed_query(question, runtime=runtime)
    embedding_str = f"[{','.join(str(x) for x in embedding)}]"

    feed_filter = ""
    episode_filter = ""
    speaker_filter = ""
    params: dict = {"embedding": embedding_str, "top_k": top_k, "threshold": SIMILARITY_THRESHOLD}
    if episode_id:
        episode_filter = "AND c.episode_id = :episode_id"
        params["episode_id"] = episode_id
    if speaker_label:
        speaker_filter = "AND c.speaker_label = :speaker_label"
        params["speaker_label"] = speaker_label
    if feed_ids:
        # Build feed filter supporting both feed IDs and "uploads" (feed_id IS NULL)
        has_uploads = "__uploads__" in feed_ids
        real_ids = [fid for fid in feed_ids if fid != "__uploads__"]
        conditions = []
        if real_ids:
            placeholders = ", ".join(f":fid_{i}" for i in range(len(real_ids)))
            conditions.append(f"e.feed_id IN ({placeholders})")
            for i, fid in enumerate(real_ids):
                params[f"fid_{i}"] = fid
        if has_uploads:
            conditions.append("e.feed_id IS NULL")
        if conditions:
            feed_filter = f"AND ({' OR '.join(conditions)})"

    query = text(f"""
        SELECT
            c.id AS chunk_id,
            c.episode_id,
            e.title AS episode_title,
            e.audio_local_path,
            COALESCE(sn.display_name, c.speaker_label) AS speaker_label,
            c.start_time,
            c.end_time,
            c.text,
            1 - (c.embedding <=> CAST(:embedding AS vector)) AS similarity
        FROM chunks c
        JOIN episodes e ON c.episode_id = e.id
        LEFT JOIN speaker_names sn
            ON sn.episode_id = c.episode_id AND sn.speaker_label = c.speaker_label
        WHERE c.embedding IS NOT NULL
            {episode_filter}
            {feed_filter}
            {speaker_filter}
        ORDER BY c.embedding <=> CAST(:embedding AS vector)
        LIMIT :top_k
    """)

    rows = db.execute(query, params).fetchall()
    return [
        ChunkResult(
            chunk_id=row.chunk_id,
            episode_id=row.episode_id,
            episode_title=row.episode_title or "Untitled Episode",
            audio_local_path=row.audio_local_path,
            speaker_label=row.speaker_label,
            start_time=row.start_time,
            end_time=row.end_time,
            text=row.text,
            similarity=row.similarity,
        )
        for row in rows
        if row.similarity >= SIMILARITY_THRESHOLD
    ]


def _format_timestamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


def build_prompt(question: str, chunks: list[ChunkResult]) -> list[dict]:
    """Build chat messages for Ollama with retrieved context."""
    context_parts = []
    for i, c in enumerate(chunks, 1):
        ts = _format_timestamp(c.start_time)
        speaker = f" ({c.speaker_label})" if c.speaker_label else ""
        context_parts.append(
            f"[{i}] {c.episode_title}, {ts}{speaker}:\n{c.text}"
        )

    context = "\n\n".join(context_parts)
    user_msg = f"""Transcript excerpts:

{context}

Question: {question}"""

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]


def chunks_to_sources(chunks: list[ChunkResult]) -> list[dict]:
    """Convert chunks to a serializable sources list for the SSE stream."""
    return [
        {
            "chunk_id": c.chunk_id,
            "episode_id": str(c.episode_id),
            "episode_title": c.episode_title,
            "audio_local_path": c.audio_local_path,
            "speaker_label": c.speaker_label,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "timestamp": _format_timestamp(c.start_time),
            "text": c.text[:200],
            "similarity": round(c.similarity, 3),
        }
        for c in chunks
    ]


async def stream_ollama_response(
    messages: list[dict],
    model: str = DEFAULT_MODEL,
):
    """Stream chat completion from Ollama. Yields token strings."""
    url = f"{settings.ollama_url}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10)) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise RuntimeError(f"Ollama returned {resp.status_code}: {body.decode()[:500]}")
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise RuntimeError(f"Ollama error: {data['error']}")
                    if content := data.get("message", {}).get("content"):
                        yield content
                    if data.get("done"):
                        return
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Ollama connection error: {type(exc).__name__}: {exc}") from exc


def _runtime_inference_value(runtime: dict | None, key: str, default):
    if runtime is not None and runtime.get(key) is not None:
        return runtime.get(key)
    return default


async def stream_fireworks_response(
    messages: list[dict],
    runtime: dict | None = None,
    model: str | None = None,
):
    """Stream chat completion from Fireworks OpenAI-compatible endpoint."""
    api_key = _runtime_inference_value(runtime, "fireworks_api_key", settings.fireworks_api_key)
    if not api_key:
        raise RuntimeError("Fireworks provider selected but FIREWORKS_API_KEY is missing")

    base_url = _runtime_inference_value(
        runtime, "fireworks_chat_base_url", settings.fireworks_chat_base_url
    ).rstrip("/")
    chat_model = model or _runtime_inference_value(
        runtime, "fireworks_chat_model", settings.fireworks_chat_model
    )

    payload = {
        "model": chat_model,
        "messages": messages,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    url = f"{base_url}/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise RuntimeError(
                        f"Fireworks returned {resp.status_code}: {body.decode(errors='ignore')[:500]}"
                    )

                async for line in resp.aiter_lines():
                    if not line:
                        continue

                    if not line.startswith("data: "):
                        continue
                    line = line[6:]

                    if line == "[DONE]":
                        return

                    data = json.loads(line)
                    if data.get("error"):
                        raise RuntimeError(f"Fireworks error: {data['error']}")

                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Fireworks connection error: {type(exc).__name__}: {exc}") from exc


async def stream_response(messages: list[dict], model: str, runtime: dict | None = None):
    """Provider-routed streaming for Ask generation."""
    provider = _runtime_inference_value(runtime, "inference_provider", settings.inference_provider)
    if provider == "fireworks":
        fireworks_model = model
        if model == DEFAULT_MODEL:
            fireworks_model = _runtime_inference_value(
                runtime, "fireworks_chat_model", settings.fireworks_chat_model
            )
        async for token in stream_fireworks_response(messages, runtime=runtime, model=fireworks_model):
            yield token
        return

    async for token in stream_ollama_response(messages, model=model):
        yield token


async def check_model_available(model: str, runtime: dict | None = None) -> bool:
    """Check if a model is available for the configured generation provider."""
    provider = _runtime_inference_value(runtime, "inference_provider", settings.inference_provider)
    if provider == "fireworks":
        return bool(_runtime_inference_value(runtime, "fireworks_api_key", settings.fireworks_api_key))

    # Local provider: check Ollama tags.
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_url}/api/tags")
            if resp.status_code != 200:
                return False
            models = resp.json().get("models", [])
            return any(m.get("name", "").startswith(model) for m in models)
    except Exception:
        return False
