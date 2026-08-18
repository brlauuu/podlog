"""Unit tests for app.tasks.chunk — chunking task."""
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def db():
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
    mock_db.query.return_value.filter.return_value.delete.return_value = 0
    return mock_db


def _make_segment(id_=1, episode_id="ep1", speaker="SPEAKER_00", start=0.0, end=5.0, text="hi"):
    seg = MagicMock()
    seg.id = id_
    seg.episode_id = episode_id
    seg.speaker_label = speaker
    seg.start_time = start
    seg.end_time = end
    seg.text = text
    return seg


class TestChunkEpisode:
    @patch("app.tasks.chunk.job_queue")
    @patch("app.tasks.chunk.update_episode")
    @patch("app.tasks.chunk.SessionLocal")
    def test_happy_path(self, mock_session_cls, mock_update, mock_jq):
        segments = [_make_segment(1), _make_segment(2, start=5.0, end=10.0)]
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segments
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        chunk_dict = {
            "speaker_label": "SPEAKER_00",
            "start_time": 0.0,
            "end_time": 10.0,
            "text": "hi hi",
            "segment_ids": [1, 2],
        }

        with patch("app.tasks.chunk.merge_segments_into_chunks", return_value=[chunk_dict]):
            from app.tasks.chunk import chunk_episode

            result = chunk_episode("ep1")

        assert result == "ep1"
        mock_update.assert_any_call(db, "ep1", status="chunking")
        db.add.assert_called_once()
        db.commit.assert_called()
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "embed")

    @patch("app.tasks.chunk.job_queue")
    @patch("app.tasks.chunk.update_episode")
    @patch("app.tasks.chunk.SessionLocal")
    def test_no_segments_skips_to_embed(self, mock_session_cls, mock_update, mock_jq):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        mock_session_cls.return_value = db

        from app.tasks.chunk import chunk_episode

        result = chunk_episode("ep1")

        assert result == "ep1"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "embed")
        db.add.assert_not_called()

    @patch("app.tasks.chunk.job_queue")
    @patch("app.tasks.chunk.update_episode")
    @patch("app.tasks.chunk.SessionLocal")
    def test_chunking_failure_is_graceful(self, mock_session_cls, mock_update, mock_jq):
        segments = [_make_segment()]
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segments
        db.query.return_value.filter.return_value.delete.side_effect = RuntimeError("boom")
        mock_session_cls.return_value = db

        from app.tasks.chunk import chunk_episode

        result = chunk_episode("ep1")

        assert result == "ep1"
        db.rollback.assert_called()
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "embed")


class TestChunkRebuildsSpeakerTurns:
    """#942: chunk is where materialized speaker turns get rebuilt.

    It is the right place because it runs after transcribe and diarize (so
    segments are final) and re-runs on retry. Asserting it here means a
    future refactor that drops the call fails a test rather than silently
    leaving episodes out of search.
    """

    @patch("app.services.speaker_turns.rebuild_speaker_turns")
    @patch("app.tasks.chunk.job_queue")
    @patch("app.tasks.chunk.update_episode")
    @patch("app.tasks.chunk.SessionLocal")
    def test_rebuilds_turns_for_the_episode(
        self, mock_session_cls, mock_update, mock_jq, mock_rebuild
    ):
        from app.tasks.chunk import chunk_episode

        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            _make_segment(1)
        ]
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        chunk_episode("ep-42")

        mock_rebuild.assert_called_once_with(db, "ep-42")

    @patch("app.services.speaker_turns.rebuild_speaker_turns")
    @patch("app.tasks.chunk.job_queue")
    @patch("app.tasks.chunk.update_episode")
    @patch("app.tasks.chunk.SessionLocal")
    def test_rebuilds_even_when_there_are_no_segments(
        self, mock_session_cls, mock_update, mock_jq, mock_rebuild
    ):
        # A re-run that produced no segments must still clear stale turns,
        # otherwise the previous run's turns linger and search shows text
        # that no longer exists.
        from app.tasks.chunk import chunk_episode

        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        mock_session_cls.return_value = db

        chunk_episode("ep-empty")

        mock_rebuild.assert_called_once_with(db, "ep-empty")
