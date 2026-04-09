"""Unit tests for RAG retrieval, prompt construction, and SSE streaming."""
import asyncio
import json
from unittest.mock import ANY, AsyncMock, MagicMock, patch

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

            events = _parse_sse(resp.text)
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
            events = _parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)

    def test_model_unavailable_returns_error(self):
        with (
            patch("app.api.ask.check_model_available", new_callable=AsyncMock, return_value=False),
            patch("app.api.ask.get_runtime_inference_settings", return_value={"inference_provider": "local"}),
        ):
            resp = client.post("/api/ask", json={"question": "test", "model": "nonexistent"})
            events = _parse_sse(resp.text)
            assert any(e["event"] == "error" for e in events)
            error_data = next(e for e in events if e["event"] == "error")
            assert "nonexistent" in error_data["data"]["message"]

    def test_fireworks_provider_skips_local_model_check(self):
        mock_chunks = [_make_chunk()]
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
            events = _parse_sse(resp.text)
            tokens = [e["data"]["content"] for e in events if e["event"] == "token"]

            assert resp.status_code == 200
            assert "".join(tokens) == "remote answer"
            mock_check.assert_not_called()


class TestRetrieveChunks:
    """Tests for retrieve_chunks — the DB query builder."""

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_basic_retrieval(self, mock_embed):
        mock_row = MagicMock()
        mock_row.chunk_id = 1
        mock_row.episode_id = "ep-1"
        mock_row.episode_title = "Test Ep"
        mock_row.speaker_label = "SPEAKER_00"
        mock_row.start_time = 10.0
        mock_row.end_time = 20.0
        mock_row.text = "Hello world"
        mock_row.similarity = 0.8

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [mock_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "test question")

        assert len(results) == 1
        assert results[0].episode_title == "Test Ep"
        assert results[0].similarity == 0.8
        mock_embed.assert_called_once_with("test question", runtime=ANY)

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_filters_below_threshold(self, mock_embed):
        low_row = MagicMock()
        low_row.chunk_id = 1
        low_row.episode_id = "ep-1"
        low_row.episode_title = "Low"
        low_row.speaker_label = None
        low_row.start_time = 0.0
        low_row.end_time = 5.0
        low_row.text = "Low sim"
        low_row.similarity = 0.1  # Below SIMILARITY_THRESHOLD (0.3)

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [low_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "test")
        assert len(results) == 0

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_uses_untitled_for_null_title(self, mock_embed):
        mock_row = MagicMock()
        mock_row.chunk_id = 1
        mock_row.episode_id = "ep-1"
        mock_row.episode_title = None
        mock_row.speaker_label = None
        mock_row.start_time = 0.0
        mock_row.end_time = 5.0
        mock_row.text = "text"
        mock_row.similarity = 0.9

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [mock_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "q")
        assert results[0].episode_title == "Untitled Episode"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_feed_ids_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["feed-1", "feed-2"])

        # Check the SQL includes feed filter params
        call_args = mock_db.execute.call_args
        params = call_args[0][1]
        assert params["fid_0"] == "feed-1"
        assert params["fid_1"] == "feed-2"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_uploads_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["__uploads__"])

        # SQL should include IS NULL condition for uploads
        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        assert "IS NULL" in query_str

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_mixed_feed_ids_and_uploads(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["feed-1", "__uploads__"])

        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        params = call_args[0][1]
        assert "IS NULL" in query_str
        assert params["fid_0"] == "feed-1"


    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_episode_id_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", episode_id="ep-42")

        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        params = call_args[0][1]
        assert "episode_id" in query_str
        assert params["episode_id"] == "ep-42"


class TestCheckModelAvailable:
    def test_model_found(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [{"name": "qwen2.5:3b"}, {"name": "llama3:8b"}]
        }

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is True

    def test_model_not_found(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [{"name": "llama3:8b"}]
        }

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False

    def test_ollama_unreachable(self):
        from app.services.rag import check_model_available

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Connection refused")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False

    def test_ollama_non_200(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 500

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False


class TestFireworksStreaming:
    def test_stream_fireworks_response_yields_content_deltas(self):
        from app.services.rag import stream_fireworks_response

        class _Resp:
            status_code = 200

            async def aread(self):
                return b""

            async def aiter_lines(self):
                yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
                yield 'data: {"choices":[{"delta":{"content":" world"}}]}'
                yield "data: [DONE]"

        class _StreamCtx:
            async def __aenter__(self):
                return _Resp()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, *args, **kwargs):
                return _StreamCtx()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def collect():
            out = []
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for token in stream_fireworks_response(
                    messages=[{"role": "user", "content": "test"}],
                    runtime={
                        "fireworks_api_key": "fw_test",
                        "fireworks_chat_base_url": "https://api.fireworks.ai/inference/v1",
                    },
                    model="accounts/fireworks/models/llama-v3p1-8b-instruct",
                ):
                    out.append(token)
            return out

        tokens = asyncio.run(collect())
        assert tokens == ["Hello", " world"]

    def test_stream_fireworks_response_ignores_sse_metadata_lines(self):
        from app.services.rag import stream_fireworks_response

        class _Resp:
            status_code = 200

            async def aread(self):
                return b""

            async def aiter_lines(self):
                yield "event: message"
                yield "id: 42"
                yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
                yield "data: [DONE]"

        class _StreamCtx:
            async def __aenter__(self):
                return _Resp()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, *args, **kwargs):
                return _StreamCtx()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def collect():
            out = []
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for token in stream_fireworks_response(
                    messages=[{"role": "user", "content": "test"}],
                    runtime={
                        "fireworks_api_key": "fw_test",
                        "fireworks_chat_base_url": "https://api.fireworks.ai/inference/v1",
                    },
                    model="accounts/fireworks/models/llama-v3p1-8b-instruct",
                ):
                    out.append(token)
            return out

        tokens = asyncio.run(collect())
        assert tokens == ["Hello"]


class TestOllamaStreaming:
    def test_stream_ollama_response_yields_tokens(self):
        from app.services.rag import stream_ollama_response

        class _Resp:
            status_code = 200

            async def aread(self):
                return b""

            async def aiter_lines(self):
                yield '{"message":{"content":"Hello"}}'
                yield '{"message":{"content":" world"}}'
                yield '{"done": true}'

        class _StreamCtx:
            async def __aenter__(self):
                return _Resp()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, *args, **kwargs):
                return _StreamCtx()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def collect():
            out = []
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for token in stream_ollama_response([{"role": "user", "content": "test"}]):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["Hello", " world"]

    def test_stream_ollama_response_non_200_raises(self):
        from app.services.rag import stream_ollama_response

        class _Resp:
            status_code = 503

            async def aread(self):
                return b"service unavailable"

            async def aiter_lines(self):
                if False:
                    yield ""

        class _StreamCtx:
            async def __aenter__(self):
                return _Resp()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, *args, **kwargs):
                return _StreamCtx()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def run():
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for _ in stream_ollama_response([{"role": "user", "content": "test"}]):
                    pass

        with pytest.raises(RuntimeError, match="Ollama returned 503"):
            asyncio.run(run())

    def test_stream_ollama_response_wraps_http_error(self):
        import httpx
        from app.services.rag import stream_ollama_response

        class _Client:
            def stream(self, *args, **kwargs):
                raise httpx.ConnectError("boom")

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def run():
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for _ in stream_ollama_response([{"role": "user", "content": "test"}]):
                    pass

        with pytest.raises(RuntimeError, match="Ollama connection error"):
            asyncio.run(run())


class TestProviderRouting:
    def test_stream_response_routes_to_fireworks(self):
        from app.services.rag import stream_response

        async def _fake_fw(*args, **kwargs):
            yield "fw"

        async def collect():
            out = []
            with (
                patch("app.services.rag.stream_fireworks_response", return_value=_fake_fw()),
                patch("app.services.rag.stream_ollama_response"),
            ):
                async for token in stream_response(
                    [{"role": "user", "content": "q"}],
                    model="qwen2.5:3b",
                    runtime={"inference_provider": "fireworks", "fireworks_chat_model": "fw-model"},
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["fw"]

    def test_stream_response_routes_to_ollama(self):
        from app.services.rag import stream_response

        async def _fake_local(*args, **kwargs):
            yield "local"

        async def collect():
            out = []
            with patch("app.services.rag.stream_ollama_response", return_value=_fake_local()):
                async for token in stream_response(
                    [{"role": "user", "content": "q"}],
                    model="qwen2.5:3b",
                    runtime={"inference_provider": "local"},
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["local"]

    def test_fireworks_requires_api_key(self):
        from app.services.rag import stream_fireworks_response

        async def run():
            async for _ in stream_fireworks_response(
                [{"role": "user", "content": "q"}], runtime={"fireworks_api_key": None}
            ):
                pass

        with pytest.raises(RuntimeError, match="FIREWORKS_API_KEY is missing"):
            asyncio.run(run())


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
