"""Unit tests for the RAG streaming layer: Fireworks stream, Ollama stream, provider routing."""
import asyncio
from unittest.mock import patch

import pytest


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
