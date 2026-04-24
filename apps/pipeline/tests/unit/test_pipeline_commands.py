"""Unit tests for app.services.pipeline_commands (#556)."""
from unittest.mock import MagicMock, patch

from app.services.pipeline_commands import (
    enqueue_episode_ingest,
    run_chunk_backfill,
)


def test_enqueue_episode_ingest_delegates_to_job_queue():
    db = MagicMock()
    with patch("app.services.pipeline_commands.job_queue.enqueue") as mock_enqueue:
        enqueue_episode_ingest(db, "ep-123")
        mock_enqueue.assert_called_once_with(db, "ep-123", "download")


def test_run_chunk_backfill_default_embed_true():
    with patch("app.tasks.backfill_chunks.backfill_chunks") as mock_backfill:
        mock_backfill.return_value = {"processed": 5}
        result = run_chunk_backfill()
        mock_backfill.assert_called_once_with(embed=True)
        assert result == {"processed": 5}


def test_run_chunk_backfill_explicit_embed_false():
    with patch("app.tasks.backfill_chunks.backfill_chunks") as mock_backfill:
        mock_backfill.return_value = {"processed": 0}
        run_chunk_backfill(embed=False)
        mock_backfill.assert_called_once_with(embed=False)
