"""Unit tests for RAG retrieval, prompt construction, and SSE streaming."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.rag import (
    ChunkResult,
    build_prompt,
    chunks_to_sources,
    _format_timestamp,
)

client = TestClient(app)


def _make_chunk(**overrides) -> ChunkResult:
    defaults = {
        "chunk_id": 1,
        "episode_id": "ep-1",
        "episode_title": "Test Episode",
        "speaker_label": "SPEAKER_00",
        "start_time": 65.0,
        "end_time": 90.0,
        "text": "This is a test transcript chunk.",
        "similarity": 0.85,
    }
    defaults.update(overrides)
    return ChunkResult(**defaults)


class TestFormatTimestamp:
    def test_under_one_minute(self):
        assert _format_timestamp(45.0) == "0:45"

    def test_over_one_minute(self):
        assert _format_timestamp(125.7) == "2:05"

    def test_zero(self):
        assert _format_timestamp(0) == "0:00"

    def test_exact_minute(self):
        assert _format_timestamp(60.0) == "1:00"


class TestBuildPrompt:
    def test_builds_system_and_user_messages(self):
        chunks = [_make_chunk(), _make_chunk(chunk_id=2, start_time=120.0, speaker_label=None)]
        messages = build_prompt("What was discussed?", chunks)

        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "transcript" in messages[0]["content"].lower()
        assert messages[1]["role"] == "user"
        assert "What was discussed?" in messages[1]["content"]

    def test_includes_chunk_metadata(self):
        chunks = [_make_chunk(episode_title="My Podcast", start_time=65.0, speaker_label="SPEAKER_00")]
        messages = build_prompt("test?", chunks)
        user_content = messages[1]["content"]

        assert "My Podcast" in user_content
        assert "1:05" in user_content
        assert "SPEAKER_00" in user_content

    def test_empty_chunks(self):
        messages = build_prompt("test?", [])
        assert len(messages) == 2
        assert "Question: test?" in messages[1]["content"]


class TestChunksToSources:
    def test_serializes_chunks(self):
        chunks = [_make_chunk()]
        sources = chunks_to_sources(chunks)

        assert len(sources) == 1
        s = sources[0]
        assert s["chunk_id"] == 1
        assert s["episode_id"] == "ep-1"
        assert s["timestamp"] == "1:05"
        assert s["similarity"] == 0.85

    def test_truncates_long_text(self):
        long_text = "x" * 500
        sources = chunks_to_sources([_make_chunk(text=long_text)])
        assert len(sources[0]["text"]) == 200


class TestAskEndpoint:
    def test_returns_sse_stream(self):
        mock_chunks = [_make_chunk()]

        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True),
            patch("app.api.ask.retrieve_chunks", return_value=mock_chunks),
            patch("app.api.ask.build_prompt", return_value=[{"role": "user", "content": "test"}]),
            patch("app.api.ask.chunks_to_sources", return_value=[{"chunk_id": 1}]),
            patch("app.api.ask.stream_ollama_response") as mock_stream,
        ):
            async def fake_stream(*args, **kwargs):
                yield "Hello"
                yield " world"

            mock_stream.return_value = fake_stream()

            resp = client.post("/api/ask", json={"question": "What was discussed?"})
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")

            events = _parse_sse(resp.text)
            event_types = [e["event"] for e in events]
            assert "sources" in event_types
            assert "token" in event_types
            assert "done" in event_types

    def test_no_chunks_returns_error_event(self):
        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True),
            patch("app.api.ask.retrieve_chunks", return_value=[]),
        ):
            resp = client.post("/api/ask", json={"question": "Unknown topic"})
            events = _parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)

    def test_model_unavailable_returns_error(self):
        with patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=False):
            resp = client.post("/api/ask", json={"question": "test", "model": "nonexistent"})
            events = _parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)
            error_data = next(e for e in events if e["event"] == "error")
            assert "nonexistent" in error_data["data"]["message"]


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE text into a list of {event, data} dicts."""
    events = []
    current_event = None
    current_data = None

    for line in text.strip().split("\n"):
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            raw = line[6:]
            try:
                current_data = json.loads(raw)
            except json.JSONDecodeError:
                current_data = raw
        elif line == "" and current_event is not None:
            events.append({"event": current_event, "data": current_data})
            current_event = None
            current_data = None

    # Handle last event if no trailing newline
    if current_event is not None:
        events.append({"event": current_event, "data": current_data})

    return events
