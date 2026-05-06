"""Unit tests for RAG pure helpers: _format_timestamp, build_prompt, chunks_to_sources."""
from app.services.rag import (
    _format_timestamp,
    build_prompt,
    chunks_to_sources,
)

from ._rag_shared import make_chunk


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
        chunks = [make_chunk(), make_chunk(chunk_id=2, start_time=120.0, speaker_label=None)]
        messages = build_prompt("What was discussed?", chunks)

        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "transcript" in messages[0]["content"].lower()
        assert messages[1]["role"] == "user"
        assert "What was discussed?" in messages[1]["content"]

    def test_includes_chunk_metadata(self):
        chunks = [make_chunk(episode_title="My Podcast", start_time=65.0, speaker_label="SPEAKER_00")]
        messages = build_prompt("test?", chunks)
        user_content = messages[1]["content"]

        assert "My Podcast" in user_content
        assert "1:05" in user_content
        assert "SPEAKER_00" in user_content

    def test_empty_chunks(self):
        messages = build_prompt("test?", [])
        assert len(messages) == 2
        assert "Question: test?" in messages[1]["content"]

    def test_custom_system_prompt_is_used(self):
        """Issue #643: caller-supplied system prompt overrides the constant."""
        chunks = [make_chunk()]
        messages = build_prompt("q?", chunks, system_prompt="CUSTOM_INSTRUCTIONS")
        assert messages[0]["content"] == "CUSTOM_INSTRUCTIONS"

    def test_default_system_prompt_when_none(self):
        chunks = [make_chunk()]
        messages = build_prompt("q?", chunks, system_prompt=None)
        assert "transcript" in messages[0]["content"].lower()


class TestChunksToSources:
    def test_serializes_chunks(self):
        chunks = [make_chunk()]
        sources = chunks_to_sources(chunks)

        assert len(sources) == 1
        s = sources[0]
        assert s["chunk_id"] == 1
        assert s["episode_id"] == "ep-1"
        assert s["timestamp"] == "1:05"
        assert s["similarity"] == 0.85

    def test_truncates_long_text(self):
        long_text = "x" * 500
        sources = chunks_to_sources([make_chunk(text=long_text)])
        assert len(sources[0]["text"]) == 200
