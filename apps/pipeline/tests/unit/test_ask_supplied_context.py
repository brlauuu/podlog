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
