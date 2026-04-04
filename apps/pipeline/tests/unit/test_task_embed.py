"""Unit tests for app.tasks.embed — embedding task."""
from unittest.mock import MagicMock, patch, call

import pytest


def _make_segment(id_=1, text="hello world", start=0.0, end=5.0):
    seg = MagicMock()
    seg.id = id_
    seg.text = text
    seg.start_time = start
    seg.end_time = end
    seg.embedding = None
    return seg


def _make_chunk(id_=1, text="chunk text", start=0.0, end=10.0):
    c = MagicMock()
    c.id = id_
    c.text = text
    c.start_time = start
    c.end_time = end
    c.embedding = None
    return c


class TestEmbedEpisode:
    @patch("app.tasks.embed.job_queue")
    @patch("app.tasks.embed.update_episode")
    @patch("app.tasks.embed.SessionLocal")
    def test_happy_path_segments_and_chunks(self, mock_session_cls, mock_update, mock_jq):
        seg = _make_segment()
        chunk = _make_chunk()
        db = MagicMock()

        # First query().filter().order_by().all() -> segments
        # Second query().filter().order_by().all() -> chunks
        db.query.return_value.filter.return_value.order_by.return_value.all.side_effect = [
            [seg], [chunk]
        ]
        mock_session_cls.return_value = db

        fake_embedding = [0.1] * 384

        with patch("app.services.embed.embed_texts", return_value=[fake_embedding]) as mock_embed:
            from app.tasks.embed import embed_episode

            result = embed_episode("ep1")

        assert result == "ep1"
        assert seg.embedding == fake_embedding
        assert chunk.embedding == fake_embedding
        mock_update.assert_any_call(db, "ep1", status="embedding")
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "infer")
        db.commit.assert_called()

    @patch("app.tasks.embed.job_queue")
    @patch("app.tasks.embed.update_episode")
    @patch("app.tasks.embed.SessionLocal")
    def test_no_segments_skips_to_infer(self, mock_session_cls, mock_update, mock_jq):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        mock_session_cls.return_value = db

        from app.tasks.embed import embed_episode

        result = embed_episode("ep1")

        assert result == "ep1"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "infer")

    @patch("app.tasks.embed.job_queue")
    @patch("app.tasks.embed.update_episode")
    @patch("app.tasks.embed.SessionLocal")
    def test_segments_without_chunks(self, mock_session_cls, mock_update, mock_jq):
        seg = _make_segment()
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.side_effect = [
            [seg], []  # segments, then no chunks
        ]
        mock_session_cls.return_value = db

        fake_embedding = [0.1] * 384

        with patch("app.services.embed.embed_texts", return_value=[fake_embedding]):
            from app.tasks.embed import embed_episode

            result = embed_episode("ep1")

        assert result == "ep1"
        assert seg.embedding == fake_embedding
        db.commit.assert_called()
