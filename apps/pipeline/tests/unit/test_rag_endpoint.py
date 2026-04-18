"""Unit tests for the /api/ask FastAPI endpoint (SSE stream wiring)."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app

from ._rag_shared import make_chunk, parse_sse

client = TestClient(app)


class TestAskEndpoint:
    def test_returns_sse_stream(self):
        mock_chunks = [make_chunk()]

        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True),
            patch("app.api.ask.get_runtime_inference_settings", return_value={"inference_provider": "local"}),
            patch("app.api.ask.retrieve_chunks", return_value=mock_chunks),
            patch("app.api.ask.build_prompt", return_value=[{"role": "user", "content": "test"}]),
            patch("app.api.ask.chunks_to_sources", return_value=[{"chunk_id": 1}]),
            patch("app.api.ask.stream_response") as mock_stream,
        ):
            async def fake_stream(*args, **kwargs):
                yield "Hello"
                yield " world"

            mock_stream.return_value = fake_stream()

            resp = client.post("/api/ask", json={"question": "What was discussed?"})
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")

            events = parse_sse(resp.text)
            event_types = [e["event"] for e in events]
            assert "sources" in event_types
            assert "token" in event_types
            assert "done" in event_types

    def test_no_chunks_returns_error_event(self):
        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True),
            patch("app.api.ask.get_runtime_inference_settings", return_value={"inference_provider": "local"}),
            patch("app.api.ask.retrieve_chunks", return_value=[]),
        ):
            resp = client.post("/api/ask", json={"question": "Unknown topic"})
            events = parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)

    def test_model_unavailable_returns_error(self):
        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=False),
            patch("app.api.ask.get_runtime_inference_settings", return_value={"inference_provider": "local"}),
        ):
            resp = client.post("/api/ask", json={"question": "test", "model": "nonexistent"})
            events = parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)
            error_data = next(e for e in events if e["event"] == "error")
            assert "nonexistent" in error_data["data"]["message"]

    def test_fireworks_provider_skips_local_model_check(self):
        mock_chunks = [make_chunk()]
        runtime = {
            "inference_provider": "fireworks",
            "fireworks_api_key": "fw_test",
            "fireworks_chat_base_url": "https://api.fireworks.ai/inference/v1",
            "fireworks_chat_model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
        }

        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=False) as mock_check,
            patch("app.api.ask.get_runtime_inference_settings", return_value=runtime),
            patch("app.api.ask.retrieve_chunks", return_value=mock_chunks),
            patch("app.api.ask.build_prompt", return_value=[{"role": "user", "content": "test"}]),
            patch("app.api.ask.chunks_to_sources", return_value=[{"chunk_id": 1}]),
            patch("app.api.ask.stream_response") as mock_stream,
        ):
            async def fake_stream(*args, **kwargs):
                yield "remote"
                yield " answer"

            mock_stream.return_value = fake_stream()

            resp = client.post("/api/ask", json={"question": "What was discussed?"})
            events = parse_sse(resp.text)
            tokens = [e["data"]["content"] for e in events if e["event"] == "token"]

            assert resp.status_code == 200
            assert "".join(tokens) == "remote answer"
            mock_check.assert_not_called()
