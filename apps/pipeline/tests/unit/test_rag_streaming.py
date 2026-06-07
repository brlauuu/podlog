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
                    runtime={"rag_provider": "fireworks", "fireworks_chat_model": "fw-model"},
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
                    runtime={"rag_provider": "local"},
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["local"]

    def test_stream_response_ignores_inference_provider_for_rag_routing(self):
        """Issue #608: rag_provider is decoupled from inference_provider.
        With inference_provider=fireworks (transcription remote) but
        rag_provider unset/local, RAG must stay local. This is the bug fix
        that motivated the whole issue.
        """
        from app.services.rag import stream_response

        async def _fake_local(*args, **kwargs):
            yield "local"

        async def collect():
            out = []
            with (
                patch(
                    "app.services.rag.stream_ollama_response",
                    return_value=_fake_local(),
                ),
                patch("app.services.rag.stream_fireworks_response") as mock_fw,
            ):
                async for token in stream_response(
                    [{"role": "user", "content": "q"}],
                    model="qwen2.5:3b",
                    runtime={
                        # Transcription is on Fireworks, but RAG is not — and
                        # rag_provider not set means it falls back to settings
                        # default (local).
                        "inference_provider": "fireworks",
                        "rag_provider": "local",
                    },
                ):
                    out.append(token)
                # Confirm Fireworks was never invoked.
                mock_fw.assert_not_called()
            return out

        assert asyncio.run(collect()) == ["local"]

    def test_stream_response_remaps_ollama_name_when_rag_provider_is_fireworks(self):
        """If a caller passes an Ollama-style model (e.g. qwen2.5:3b) while
        rag_provider=fireworks, the Fireworks call must use the configured
        fireworks_chat_model instead of forwarding the Ollama name (which
        would 404)."""
        from app.services.rag import stream_response

        async def _fake_fw(*args, **kwargs):
            yield "fw"

        captured: dict[str, object] = {}

        def capture(messages, runtime=None, model=None):
            captured["model"] = model
            return _fake_fw()

        async def collect():
            out = []
            with patch(
                "app.services.rag.stream_fireworks_response",
                side_effect=capture,
            ):
                async for token in stream_response(
                    [{"role": "user", "content": "q"}],
                    model="qwen2.5:3b",
                    runtime={
                        "rag_provider": "fireworks",
                        "fireworks_chat_model": "accounts/fireworks/models/qwen2p5-72b-instruct",
                    },
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["fw"]
        assert captured["model"] == "accounts/fireworks/models/qwen2p5-72b-instruct"

    def test_stream_response_passes_through_fireworks_path_unchanged(self):
        """When the caller already sent a Fireworks model path, use it as-is."""
        from app.services.rag import stream_response

        async def _fake_fw(*args, **kwargs):
            yield "fw"

        captured: dict[str, object] = {}

        def capture(messages, runtime=None, model=None):
            captured["model"] = model
            return _fake_fw()

        async def collect():
            out = []
            with patch(
                "app.services.rag.stream_fireworks_response",
                side_effect=capture,
            ):
                async for token in stream_response(
                    [{"role": "user", "content": "q"}],
                    model="accounts/fireworks/models/llama-v3p3-70b-instruct",
                    runtime={
                        "rag_provider": "fireworks",
                        "fireworks_chat_model": "accounts/fireworks/models/qwen2p5-72b-instruct",
                    },
                ):
                    out.append(token)
            return out

        assert asyncio.run(collect()) == ["fw"]
        # The caller's model wins over the configured default.
        assert (
            captured["model"]
            == "accounts/fireworks/models/llama-v3p3-70b-instruct"
        )

    def test_fireworks_requires_api_key(self):
        from app.services.rag import stream_fireworks_response

        async def run():
            async for _ in stream_fireworks_response(
                [{"role": "user", "content": "q"}], runtime={"fireworks_api_key": None}
            ):
                pass

        with pytest.raises(RuntimeError, match="FIREWORKS_API_KEY is missing"):
            asyncio.run(run())

    def test_fireworks_404_raises_actionable_message(self):
        """Issue #608: a 404 from Fireworks (deprecated/missing model) must
        surface a message naming the offending model and pointing the user
        at Settings, instead of leaking the raw provider response."""
        from app.services.rag import stream_fireworks_response

        class _Resp:
            status_code = 404

            async def aread(self):
                return b'{"error":{"message":"Model not found"}}'

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
                async for _ in stream_fireworks_response(
                    [{"role": "user", "content": "q"}],
                    runtime={
                        "fireworks_api_key": "fw_test",
                        "fireworks_chat_base_url": "https://api.fireworks.ai/inference/v1",
                        "fireworks_chat_model": "accounts/fireworks/models/missing-v1",
                    },
                ):
                    pass

        with pytest.raises(RuntimeError) as excinfo:
            asyncio.run(run())
        msg = str(excinfo.value)
        # Names the offending model and points at Settings.
        assert "accounts/fireworks/models/missing-v1" in msg
        assert "Settings" in msg
        assert "RAG" in msg or "Ask" in msg
