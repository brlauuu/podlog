"""Unit tests for the /api/ask FastAPI endpoint (SSE stream wiring)."""
from contextlib import ExitStack
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
            patch("app.api.ask.get_prompt", return_value="SYSTEM"),
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

    def test_uses_runtime_rag_local_model_when_request_omits_model(self):
        # Issue #637: when the caller doesn't supply `model`, fall back to the
        # admin-configured rag_local_model rather than the hardcoded default.
        mock_chunks = [make_chunk()]
        runtime = {"rag_provider": "local", "rag_local_model": "phi3:mini"}

        captured = {}

        async def fake_stream(*args, **kwargs):
            captured["model"] = kwargs.get("model")
            yield "ok"

        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True),
            patch("app.api.ask.get_runtime_inference_settings", return_value=runtime),
            patch("app.api.ask.retrieve_chunks", return_value=mock_chunks),
            patch("app.api.ask.get_prompt", return_value="SYSTEM"),
            patch("app.api.ask.build_prompt", return_value=[{"role": "user", "content": "test"}]),
            patch("app.api.ask.chunks_to_sources", return_value=[{"chunk_id": 1}]),
            patch("app.api.ask.stream_response", side_effect=fake_stream),
        ):
            resp = client.post("/api/ask", json={"question": "What was discussed?"})
            assert resp.status_code == 200

        assert captured["model"] == "phi3:mini"

    def test_fireworks_provider_skips_local_model_check(self):
        mock_chunks = [make_chunk()]
        runtime = {
            # Issue #608: RAG/Ask uses its own provider flag now.
            "rag_provider": "fireworks",
            "fireworks_api_key": "fw_test",
            "fireworks_chat_base_url": "https://api.fireworks.ai/inference/v1",
            "fireworks_chat_model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
        }

        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=False) as mock_check,
            patch("app.api.ask.get_runtime_inference_settings", return_value=runtime),
            patch("app.api.ask.retrieve_chunks", return_value=mock_chunks),
            patch("app.api.ask.get_prompt", return_value="SYSTEM"),
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


class TestAskHistory:
    """Issue #699: prior turns flow through to build_prompt."""

    def _enter_patches(self, stack: ExitStack, mock_chunks):
        stack.enter_context(patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=True))
        stack.enter_context(patch("app.api.ask.get_runtime_inference_settings", return_value={"inference_provider": "local"}))
        stack.enter_context(patch("app.api.ask.retrieve_chunks", return_value=mock_chunks))
        stack.enter_context(patch("app.api.ask.get_prompt", return_value="SYSTEM"))
        stack.enter_context(patch("app.api.ask.chunks_to_sources", return_value=[{"chunk_id": 1}]))

    @staticmethod
    def _fake_stream():
        async def gen(*_a, **_kw):
            yield "ok"
        return gen

    def test_history_passed_through_to_build_prompt(self):
        with ExitStack() as stack:
            self._enter_patches(stack, [make_chunk()])
            mock_build = stack.enter_context(patch("app.api.ask.build_prompt", return_value=[]))
            mock_stream = stack.enter_context(patch("app.api.ask.stream_response"))
            mock_stream.return_value = self._fake_stream()()

            history = [
                {"role": "user", "content": "Q1"},
                {"role": "assistant", "content": "A1"},
            ]
            resp = client.post("/api/ask", json={"question": "Q2", "history": history})

            assert resp.status_code == 200
            assert mock_build.call_args.kwargs["history"] == history

    def test_omitted_history_yields_empty_list_to_build_prompt(self):
        """Backwards-compat: callers that don't send history get [] (empty)."""
        with ExitStack() as stack:
            self._enter_patches(stack, [make_chunk()])
            mock_build = stack.enter_context(patch("app.api.ask.build_prompt", return_value=[]))
            mock_stream = stack.enter_context(patch("app.api.ask.stream_response"))
            mock_stream.return_value = self._fake_stream()()

            resp = client.post("/api/ask", json={"question": "Q1"})

            assert resp.status_code == 200
            assert mock_build.call_args.kwargs["history"] == []

    def test_history_capped_to_max_messages(self):
        """Defensive: server caps over-long histories to MAX_HISTORY_MESSAGES."""
        from app.api.ask import MAX_HISTORY_MESSAGES

        long_history = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg-{i}"}
            for i in range(20)
        ]
        with ExitStack() as stack:
            self._enter_patches(stack, [make_chunk()])
            mock_build = stack.enter_context(patch("app.api.ask.build_prompt", return_value=[]))
            mock_stream = stack.enter_context(patch("app.api.ask.stream_response"))
            mock_stream.return_value = self._fake_stream()()

            resp = client.post("/api/ask", json={"question": "Q", "history": long_history})

            assert resp.status_code == 200
            received = mock_build.call_args.kwargs["history"]
            assert len(received) == MAX_HISTORY_MESSAGES
            # The cap keeps the tail (most recent) — freshest context for the LLM.
            assert received[-1]["content"] == "msg-19"

    def test_invalid_history_role_returns_422(self):
        """Pydantic Literal["user","assistant"] rejects "system" etc."""
        resp = client.post(
            "/api/ask",
            json={
                "question": "Q",
                "history": [{"role": "system", "content": "shouldn't work"}],
            },
        )
        assert resp.status_code == 422
