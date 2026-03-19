"""Tests for the DB-backed job queue module."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

from app.models import Job


class TestJobQueue:
    def test_enqueue_creates_job(self):
        db = MagicMock()
        db.refresh = MagicMock()

        with patch("app.job_queue.Job") as MockJob:
            mock_job = MagicMock()
            mock_job.id = 1
            MockJob.return_value = mock_job

            from app.job_queue import enqueue
            result = enqueue(db, "ep-1", "download")

            MockJob.assert_called_once_with(episode_id="ep-1", task="download", retry_at=None)
            db.add.assert_called_once_with(mock_job)
            db.commit.assert_called_once()

    def test_enqueue_with_retry_at(self):
        db = MagicMock()
        db.refresh = MagicMock()
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=30)

        with patch("app.job_queue.Job") as MockJob:
            mock_job = MagicMock()
            mock_job.id = 1
            MockJob.return_value = mock_job

            from app.job_queue import enqueue
            enqueue(db, "ep-1", "download", retry_at=retry_at)

            MockJob.assert_called_once_with(episode_id="ep-1", task="download", retry_at=retry_at)

    def test_complete_sets_status_done(self):
        db = MagicMock()
        job = MagicMock()
        job.id = 1
        job.task = "download"

        from app.job_queue import complete
        complete(db, job)

        assert job.status == "done"
        db.commit.assert_called_once()

    def test_fail_sets_status_and_error(self):
        db = MagicMock()
        job = MagicMock()
        job.id = 1
        job.task = "download"

        from app.job_queue import fail
        fail(db, job, "something went wrong")

        assert job.status == "failed"
        assert job.error == "something went wrong"
        db.commit.assert_called_once()
