"""Unit tests for app.tasks.backfill_chunks — chunk backfill task."""
from unittest.mock import MagicMock, patch

import pytest


def _make_episode(id_="ep1", status="done"):
    ep = MagicMock()
    ep.id = id_
    ep.status = status
    ep.processed_at = None
    return ep


def _make_segment(id_=1, episode_id="ep1", speaker="SPEAKER_00", start=0.0, end=5.0, text="hi"):
    seg = MagicMock()
    seg.id = id_
    seg.episode_id = episode_id
    seg.speaker_label = speaker
    seg.start_time = start
    seg.end_time = end
    seg.text = text
    return seg


class TestBackfillChunks:
    @patch("app.tasks.backfill_chunks.SessionLocal")
    def test_happy_path_with_embed(self, mock_session_cls):
        ep = _make_episode()
        seg = _make_segment()
        db = MagicMock()

        # episodes query
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [ep]
        # segments query for ep
        db.query.return_value.filter.return_value.order_by.return_value.all.side_effect = [
            [ep],  # episodes
            [seg],  # segments for ep
        ]
        # Reset for per-episode segment query
        mock_session_cls.return_value = db

        chunk_dict = {
            "speaker_label": "SPEAKER_00",
            "start_time": 0.0,
            "end_time": 5.0,
            "text": "hi",
            "segment_ids": [1],
        }

        with (
            patch("app.tasks.backfill_chunks.merge_segments_into_chunks", return_value=[chunk_dict]),
            patch("app.services.embed.embed_texts", return_value=[[0.1] * 384]),
        ):
            from app.tasks.backfill_chunks import backfill_chunks

            result = backfill_chunks(embed=True)

        assert result["episodes_chunked"] == 1
        assert result["chunks_created"] == 1
        db.commit.assert_called()

    @patch("app.tasks.backfill_chunks.SessionLocal")
    def test_skips_episodes_without_segments(self, mock_session_cls):
        ep = _make_episode()
        db = MagicMock()

        # Episodes query returns one, then segments query returns empty
        db.query.return_value.filter.return_value.order_by.return_value.all.side_effect = [
            [ep],  # episodes
            [],    # no segments
        ]
        mock_session_cls.return_value = db

        with patch("app.tasks.backfill_chunks.merge_segments_into_chunks") as mock_merge:
            from app.tasks.backfill_chunks import backfill_chunks

            result = backfill_chunks(embed=False)

        assert result["episodes_skipped"] == 1
        assert result["chunks_created"] == 0
        mock_merge.assert_not_called()

    @patch("app.tasks.backfill_chunks.SessionLocal")
    def test_no_embed_skips_embedding(self, mock_session_cls):
        ep = _make_episode()
        seg = _make_segment()
        db = MagicMock()

        db.query.return_value.filter.return_value.order_by.return_value.all.side_effect = [
            [ep],   # episodes
            [seg],  # segments
        ]
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        chunk_dict = {
            "speaker_label": "SPEAKER_00",
            "start_time": 0.0,
            "end_time": 5.0,
            "text": "hi",
            "segment_ids": [1],
        }

        with patch("app.tasks.backfill_chunks.merge_segments_into_chunks", return_value=[chunk_dict]):
            from app.tasks.backfill_chunks import backfill_chunks

            result = backfill_chunks(embed=False)

        assert result["episodes_chunked"] == 1
