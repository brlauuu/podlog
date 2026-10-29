"""Unit tests for the RAG streaming layer: Fireworks stream, Ollama stream, provider routing."""
import asyncio
from unittest.mock import patch

import pytest


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

    def test_stream_ollama_response_sets_num_ctx_per_model(self):
        """Regression guard for issue #138: per-model num_ctx is sent to Ollama."""
        from app.services.rag import stream_ollama_response, MODEL_NUM_CTX, DEFAULT_NUM_CTX

        captured_payloads = []

        class _Resp:
            status_code = 200

            async def aread(self):
                return b""

            async def aiter_lines(self):
                yield '{"done": true}'

        class _StreamCtx:
            async def __aenter__(self):
                return _Resp()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, method, url, json=None, **kwargs):
                captured_payloads.append(json)
                return _StreamCtx()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        async def run(model):
            with patch("app.services.rag.httpx.AsyncClient", return_value=_Client()):
                async for _ in stream_ollama_response(
                    [{"role": "user", "content": "test"}], model=model
                ):
                    pass

        asyncio.run(run("qwen2.5:3b"))
        asyncio.run(run("gemma3n:e4b"))
        asyncio.run(run("unknown-model:foo"))

        assert captured_payloads[0]["options"]["num_ctx"] == MODEL_NUM_CTX["qwen2.5:3b"]
        assert captured_payloads[1]["options"]["num_ctx"] == MODEL_NUM_CTX["gemma3n:e4b"]
        assert captured_payloads[2]["options"]["num_ctx"] == DEFAULT_NUM_CTX

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


class TestOllamaOOMRetry:
    """On preflight OOM, rag.py unloads resident models and retries once."""

    @staticmethod
    def _resp(status_code: int, body: bytes, stream_lines: list[str] | None = None):
        class _Resp:
            def __init__(self):
                self.status_code = status_code

            async def aread(self):
                return body

            async def aiter_lines(self):
                for line in stream_lines or []:
                    yield line

        return _Resp()

    @staticmethod
    def _client(responses):
        """Factory returning an httpx.AsyncClient double that yields `responses` in order."""
        iterator = iter(responses)

        class _StreamCtx:
            def __init__(self, resp):
                self._resp = resp

            async def __aenter__(self):
                return self._resp

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class _Client:
            def stream(self, *args, **kwargs):
                return _StreamCtx(next(iterator))

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        return _Client()

    def test_oom_then_success_retries_once_after_unload(self):
        from app.services.rag import stream_ollama_response

        oom_body = b'{"error":"model requires more system memory (1.9 GiB) than is available (555.8 MiB)"}'
        first = self._resp(500, oom_body)
        second = self._resp(
            200,
            b"",
            stream_lines=['{"message":{"content":"ok"}}', '{"done": true}'],
        )
        client = self._client([first, second])

        unload_calls = 0

        async def _fake_unload():
            nonlocal unload_calls
            unload_calls += 1

        async def run():
            out = []
            with (
                patch("app.services.rag.httpx.AsyncClient", return_value=client),
                patch("app.services.rag._unload_loaded_ollama_models", _fake_unload),
            ):
                async for token in stream_ollama_response(
                    [{"role": "user", "content": "q"}], model="qwen2.5:3b"
                ):
                    out.append(token)
            return out

        assert asyncio.run(run()) == ["ok"]
        assert unload_calls == 1

    def test_oom_on_both_attempts_raises_actionable_message(self):
        from app.services.rag import stream_ollama_response

        oom_body = b'{"error":"model requires more system memory (1.9 GiB) than is available (555.8 MiB)"}'
        client = self._client([self._resp(500, oom_body), self._resp(500, oom_body)])

        async def _fake_unload():
            return None

        async def run():
            with (
                patch("app.services.rag.httpx.AsyncClient", return_value=client),
                patch("app.services.rag._unload_loaded_ollama_models", _fake_unload),
            ):
                async for _ in stream_ollama_response(
                    [{"role": "user", "content": "q"}], model="qwen2.5:3b"
                ):
                    pass

        with pytest.raises(RuntimeError, match=r"docker restart podlog-ollama-1"):
            asyncio.run(run())

    def test_non_oom_500_does_not_retry(self):
        from app.services.rag import stream_ollama_response

        # 500 without the OOM marker → immediate raise, no retry.
        client = self._client([self._resp(500, b'{"error":"internal server error"}')])

        unload_calls = 0

        async def _fake_unload():
            nonlocal unload_calls
            unload_calls += 1

        async def run():
            with (
                patch("app.services.rag.httpx.AsyncClient", return_value=client),
                patch("app.services.rag._unload_loaded_ollama_models", _fake_unload),
            ):
                async for _ in stream_ollama_response([{"role": "user", "content": "q"}]):
                    pass

        with pytest.raises(RuntimeError, match="Ollama returned 500"):
            asyncio.run(run())
        assert unload_calls == 0

    def test_oom_mid_stream_does_not_retry(self):
        """If tokens have already streamed, a mid-stream OOM surfaces directly."""
        from app.services.rag import stream_ollama_response

        mid_stream_oom = self._resp(
            200,
            b"",
            stream_lines=[
                '{"message":{"content":"hello"}}',
                '{"error":"model requires more system memory"}',
            ],
        )
        client = self._client([mid_stream_oom])

        unload_calls = 0

        async def _fake_unload():
            nonlocal unload_calls
            unload_calls += 1

        async def run():
            out = []
            with (
                patch("app.services.rag.httpx.AsyncClient", return_value=client),
                patch("app.services.rag._unload_loaded_ollama_models", _fake_unload),
            ):
                async for token in stream_ollama_response([{"role": "user", "content": "q"}]):
                    out.append(token)
            return out

        with pytest.raises(RuntimeError, match="mid-response"):
            asyncio.run(run())
        assert unload_calls == 0


class TestProviderRouting:

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
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["local"]
