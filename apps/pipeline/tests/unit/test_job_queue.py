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


class TestClaim:
    """Cover the FOR UPDATE SKIP LOCKED claim path (#822)."""

    def _query_chain(self, db, returns):
        """Wire up the chained query() chain to return `returns` from .first()."""
        chain = db.query.return_value
        chain.filter.return_value = chain
        chain.order_by.return_value = chain
        chain.with_for_update.return_value = chain
        chain.first.return_value = returns

    def test_returns_none_when_no_pending_job(self):
        db = MagicMock()
        self._query_chain(db, None)
        from app.job_queue import poll
        assert poll(db) is None
        # commit/refresh should NOT be called when no job is found
        db.commit.assert_not_called()
        db.refresh.assert_not_called()

    def test_returns_job_and_marks_picked(self):
        db = MagicMock()
        job = MagicMock(spec=Job)
        job.status = "pending"
        job.attempt = 0
        self._query_chain(db, job)
        from app.job_queue import poll
        result = poll(db)
        assert result is job
        assert job.status == "picked"
        assert job.attempt == 1
        # picked_at is set to current UTC time
        assert job.picked_at is not None
        # Single commit + refresh from this path
        db.commit.assert_called_once()
        db.refresh.assert_called_once_with(job)

    def test_increments_attempt_counter(self):
        db = MagicMock()
        job = MagicMock(spec=Job)
        job.status = "pending"
        job.attempt = 3
        self._query_chain(db, job)
        from app.job_queue import poll
        poll(db)
        assert job.attempt == 4

    def test_uses_skip_locked_on_with_for_update(self):
        # The claim should call with_for_update(skip_locked=True) so multiple
        # workers don't fight for the same row.
        db = MagicMock()
        self._query_chain(db, None)
        from app.job_queue import poll
        poll(db)
        chain = db.query.return_value.filter.return_value.order_by.return_value
        chain.with_for_update.assert_called_once_with(skip_locked=True)
