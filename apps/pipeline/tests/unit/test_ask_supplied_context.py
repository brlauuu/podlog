"""#990: /api/ask can answer over caller-supplied passages.

The transcript path must be untouched -- a request without `context`
still retrieves chunks. That regression guard is the point of this file
as much as the new behaviour is.
"""
from unittest.mock import MagicMock, patch

import pytest

from app.api.ask import AskRequest, ContextSection


class TestAskRequestContext:
    def test_context_defaults_to_none(self):
        req = AskRequest(question="why?")
        assert req.context is None

    def test_context_accepts_sections(self):
        req = AskRequest(
            question="why is Whisper unloaded?",
            context=[
                ContextSection(
                    title="Memory", source="guide", slug="19-inference-providers",
                    anchor="a-note-on-memory", repo_path="docs/guide/19-inference-providers.md",
                    text="Whisper is unloaded before pyannote loads.",
                )
            ],
        )
        assert req.context is not None
        assert req.context[0].source == "guide"


class TestBuildPromptFromText:
    def test_passages_appear_in_the_prompt(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text(
            "why?", ["Whisper is unloaded before pyannote loads."],
            system_prompt="SYS",
        )
        joined = " ".join(m["content"] for m in msgs)
        assert "Whisper is unloaded" in joined
        assert "why?" in joined

    def test_system_prompt_is_honoured(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text("q", ["p"], system_prompt="CUSTOM")
        assert msgs[0]["role"] == "system"
        assert msgs[0]["content"] == "CUSTOM"

    def test_history_is_inserted_between_system_and_user(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text(
            "q", ["p"], system_prompt="SYS",
            history=[{"role": "user", "content": "earlier"}],
        )
        assert msgs[0]["role"] == "system"
        assert msgs[1]["content"] == "earlier"
        assert msgs[-1]["role"] == "user"


class TestTranscriptPathUnchanged:
    """The branch must not disturb /ask. This is the guard for that."""

    async def _drain(self, gen):
        return [frame async for frame in gen]

    @pytest.mark.asyncio
    async def test_no_context_still_retrieves_chunks(self):
        from app.api import ask as ask_mod

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "retrieve_chunks", return_value=[]) as mock_ret,
        ):
            await self._drain(ask_mod._stream_ask("carbon pricing", None, None))

        mock_ret.assert_called_once()

    @pytest.mark.asyncio
    async def test_supplied_context_skips_retrieval(self):
        from app.api import ask as ask_mod

        section = ContextSection(
            title="Memory", source="guide", slug="19-inference-providers",
            anchor="a-note-on-memory",
            repo_path="docs/guide/19-inference-providers.md",
            text="Whisper is unloaded before pyannote loads.",
        )

        async def _fake_stream(*args, **kwargs):
            yield "answer"

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "get_prompt", return_value="SYS"),
            patch.object(ask_mod, "stream_response", _fake_stream),
            patch.object(ask_mod, "retrieve_chunks") as mock_ret,
        ):
            frames = await self._drain(
                ask_mod._stream_ask("why?", None, None, context=[section])
            )

        mock_ret.assert_not_called()
        assert any("a-note-on-memory" in f for f in frames)


class TestSuppliedSystemPrompt:
    """#990: the docs caller needs its own instructions.

    The stored ask_page_system prompt mandates [Episode Title, MM:SS]
    citations. A documentation answer has no episode and no timestamp, and
    the model emitted "[Context, N/A]" after every sentence -- found by
    asking a real question through a real stack, not by a unit test.
    """

    async def _drain(self, gen):
        return [frame async for frame in gen]

    def _section(self):
        return ContextSection(
            title="Memory", source="guide", slug="19-inference-providers",
            anchor="a-note-on-memory",
            repo_path="docs/guide/19-inference-providers.md",
            text="Whisper is unloaded before pyannote loads.",
        )

    def test_request_accepts_a_system_prompt(self):
        req = AskRequest(question="q", system_prompt="DOCS")
        assert req.system_prompt == "DOCS"

    @pytest.mark.asyncio
    async def test_supplied_prompt_is_used_instead_of_the_stored_one(self):
        from app.api import ask as ask_mod

        captured = {}

        def _capture(question, passages, system_prompt=None, history=None):
            captured["system_prompt"] = system_prompt
            return [{"role": "system", "content": system_prompt or ""}]

        async def _fake_stream(*args, **kwargs):
            yield "x"

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "get_prompt", return_value="STORED"),
            patch.object(ask_mod, "stream_response", _fake_stream),
            patch.object(ask_mod, "build_prompt_from_text", _capture),
        ):
            await self._drain(
                ask_mod._stream_ask(
                    "why?", None, None,
                    context=[self._section()], system_prompt="DOCS",
                )
            )

        assert captured["system_prompt"] == "DOCS"

    @pytest.mark.asyncio
    async def test_falls_back_to_the_stored_prompt_when_none_supplied(self):
        from app.api import ask as ask_mod

        captured = {}

        def _capture(question, passages, system_prompt=None, history=None):
            captured["system_prompt"] = system_prompt
            return [{"role": "system", "content": system_prompt or ""}]

        async def _fake_stream(*args, **kwargs):
            yield "x"

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "get_prompt", return_value="STORED"),
            patch.object(ask_mod, "stream_response", _fake_stream),
            patch.object(ask_mod, "build_prompt_from_text", _capture),
        ):
            await self._drain(
                ask_mod._stream_ask("why?", None, None, context=[self._section()])
            )

        assert captured["system_prompt"] == "STORED"

    @pytest.mark.asyncio
    async def test_transcript_path_ignores_a_supplied_prompt(self):
        """The operator's stored prompt is not overridable per request."""
        from app.api import ask as ask_mod

        captured = {}

        def _capture(question, chunks, system_prompt=None, history=None):
            captured["system_prompt"] = system_prompt
            return [{"role": "system", "content": system_prompt or ""}]

        async def _fake_stream(*args, **kwargs):
            yield "x"

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "get_prompt", return_value="STORED"),
            patch.object(ask_mod, "retrieve_chunks", return_value=["chunk"]),
            patch.object(ask_mod, "chunks_to_sources", return_value=[]),
            patch.object(ask_mod, "stream_response", _fake_stream),
            patch.object(ask_mod, "build_prompt", _capture),
        ):
            await self._drain(
                ask_mod._stream_ask("q", None, None, system_prompt="ATTACKER")
            )

        assert captured["system_prompt"] == "STORED"


class TestProviderRoutingOnTheContextPath:
    """#990: the docs path must obey the same Settings as transcript Ask.

    Provider comes from rag_provider, model from rag_local_model /
    fireworks_chat_model. A caller that pins a model wins over the stored
    one -- which is why the docs bubble sends none.
    """

    async def _drain(self, gen):
        return [frame async for frame in gen]

    def _section(self):
        return ContextSection(
            title="Memory", source="guide", slug="19-inference-providers",
            anchor=None, repo_path="docs/guide/19-inference-providers.md",
            text="Whisper is unloaded before pyannote loads.",
        )

    async def _resolved_model(self, runtime, model=None):
        from app.api import ask as ask_mod

        captured = {}

        async def _fake_stream(messages, model=None, runtime=None):
            captured["model"] = model
            yield "x"

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value=runtime),
            patch.object(ask_mod, "check_model_available", return_value=True),
            patch.object(ask_mod, "get_prompt", return_value="SYS"),
            patch.object(ask_mod, "stream_response", _fake_stream),
        ):
            await self._drain(
                ask_mod._stream_ask(
                    "why?", model, None, context=[self._section()]
                )
            )
        return captured["model"]

    @pytest.mark.asyncio
    async def test_unpinned_uses_the_configured_local_model(self):
        got = await self._resolved_model(
            {"rag_provider": "local", "rag_local_model": "phi3:mini"}
        )
        assert got == "phi3:mini"

    @pytest.mark.asyncio
    async def test_unpinned_uses_the_configured_fireworks_model(self):
        got = await self._resolved_model(
            {
                "rag_provider": "fireworks",
                "fireworks_api_key": "fw-key",
                "fireworks_chat_model": "accounts/fireworks/models/llama-v3p1-70b",
            }
        )
        assert got == "accounts/fireworks/models/llama-v3p1-70b"

    @pytest.mark.asyncio
    async def test_a_pinned_model_overrides_the_configured_one(self):
        """This is the trap the bubble avoids by sending no model."""
        got = await self._resolved_model(
            {"rag_provider": "local", "rag_local_model": "phi3:mini"},
            model="qwen2.5:3b",
        )
        assert got == "qwen2.5:3b"
