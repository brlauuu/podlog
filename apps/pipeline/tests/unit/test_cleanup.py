"""
Unit tests for zombie job cleanup task -- GAP-01 / RISK-01

Zombie detection now operates on Job records (status='picked'), not Episodes.
Only jobs that have actually started running and exceeded their expected
runtime are marked as zombies. Pending jobs are never touched.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from app.tasks.cleanup import cleanup_zombie_jobs


def _make_job(task: str, picked_minutes_ago: float, status: str = "picked") -> MagicMock:
    job = MagicMock()
    job.id = 1
    job.task = task
    job.status = status
    job.episode_id = f"ep-{task}"
    job.picked_at = datetime.now(timezone.utc) - timedelta(minutes=picked_minutes_ago)
    return job


def _make_episode(episode_id: str, duration_secs: int | None = 3600) -> MagicMock:
    ep = MagicMock()
    ep.id = episode_id
    ep.status = "transcribing"
    ep.duration_secs = duration_secs
    return ep


def _make_settings(
    realtime_factor: float = 1.5,
    timeout_multiplier: float = 2.0,
    min_timeout_minutes: int = 60,
) -> MagicMock:
    s = MagicMock()
    s.zombie_realtime_factor = realtime_factor
    s.zombie_timeout_multiplier = timeout_multiplier
    s.zombie_min_timeout_minutes = min_timeout_minutes
    return s


class TestCleanupZombieJobs:
    def test_marks_picked_job_as_zombie_when_over_timeout(self):
        """A job that has been running for longer than expected × multiplier is zombie."""
        # 1hr audio × 1.5 factor × 2 multiplier = 3hr timeout → running 4hr = zombie
        job = _make_job("transcribe", picked_minutes_ago=240)
        episode = _make_episode("ep-transcribe", duration_secs=3600)

        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [job]
        db.query.return_value.filter.return_value.first.return_value = episode

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings()), \
             patch("app.tasks.helpers.mark_failed") as mock_mark_failed:
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 1
        assert job.status == "failed"
        assert "Zombie" in job.error
        mock_mark_failed.assert_called_once()
        call_kwargs = mock_mark_failed.call_args
        assert call_kwargs[1]["error_class"] == "SYSTEM_ERROR"

    def test_does_not_mark_picked_job_within_timeout(self):
        """A job running within expected time is NOT a zombie."""
        # 1hr audio × 1.5 × 2 = 3hr timeout → running 2hr = fine
        job = _make_job("transcribe", picked_minutes_ago=120)
        episode = _make_episode("ep-transcribe", duration_secs=3600)

        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [job]
        db.query.return_value.filter.return_value.first.return_value = episode

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings()):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 0
        assert job.status == "picked"  # unchanged

    def test_pending_jobs_are_never_checked(self):
        """Only picked jobs are queried — pending jobs are invisible to zombie cleanup."""
        db = MagicMock()
        # The query filters for status='picked', so pending jobs never appear
        db.query.return_value.filter.return_value.all.return_value = []

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings()):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 0

    def test_uses_min_timeout_when_no_duration(self):
        """When episode has no duration_secs, falls back to min_timeout_minutes."""
        # min_timeout = 60min → running 90min = zombie
        job = _make_job("diarize", picked_minutes_ago=90)
        episode = _make_episode("ep-diarize", duration_secs=None)

        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [job]
        db.query.return_value.filter.return_value.first.return_value = episode

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings(min_timeout_minutes=60)), \
             patch("app.tasks.helpers.mark_failed"):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 1

    def test_min_timeout_floor_applies(self):
        """Short episodes still get at least zombie_min_timeout_minutes."""
        # 5min audio × 1.5 × 2 = 15min, but min_timeout = 60min
        # running 30min → should NOT be zombie (floor protects)
        job = _make_job("transcribe", picked_minutes_ago=30)
        episode = _make_episode("ep-transcribe", duration_secs=300)

        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [job]
        db.query.return_value.filter.return_value.first.return_value = episode

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings(min_timeout_minutes=60)):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 0

    def test_no_picked_jobs_returns_zero(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings()):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 0
        db.commit.assert_not_called()

    def test_rolls_back_and_reraises_on_exception(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.side_effect = RuntimeError("db gone")

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.config.settings", _make_settings()):
            with pytest.raises(RuntimeError, match="db gone"):
                cleanup_zombie_jobs()

        db.rollback.assert_called_once()
        db.close.assert_called_once()


# ---------------------------------------------------------------------------
# Issue #641: stranded-episode sweep
# ---------------------------------------------------------------------------


class TestResolveStrandedTask:
    def test_maps_canonical_statuses(self):
        from app.tasks.cleanup import _resolve_stranded_task

        assert _resolve_stranded_task("downloading") == "download"
        assert _resolve_stranded_task("transcribing") == "transcribe"
        assert _resolve_stranded_task("diarizing") == "diarize"
        assert _resolve_stranded_task("chunking") == "chunk"
        assert _resolve_stranded_task("embedding") == "embed"
        assert _resolve_stranded_task("inferring") == "infer"
        assert _resolve_stranded_task("archiving") == "archive"

    def test_progress_tagged_downloading_maps_to_download(self):
        """``downloading:70%`` is download.py's progress-tagged variant."""
        from app.tasks.cleanup import _resolve_stranded_task

        assert _resolve_stranded_task("downloading:0%") == "download"
        assert _resolve_stranded_task("downloading:70%") == "download"
        assert _resolve_stranded_task("downloading:100%") == "download"

    def test_unknown_status_returns_none(self):
        from app.tasks.cleanup import _resolve_stranded_task

        assert _resolve_stranded_task("done") is None
        assert _resolve_stranded_task("failed") is None
        assert _resolve_stranded_task("pending") is None
        assert _resolve_stranded_task("frobnicating") is None


class TestRecoverStrandedEpisodes:
    def _make_episode(self, status: str, episode_id: str = "ep-1") -> MagicMock:
        ep = MagicMock()
        ep.id = episode_id
        ep.status = status
        return ep

    def _setup_db(self, stranded_episodes: list) -> MagicMock:
        """Wire a mock DB to return the given list from the stranded query."""
        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.all.return_value = (
            stranded_episodes
        )
        return db

    def test_resets_status_and_enqueues_appropriate_task(self):
        from app.tasks.cleanup import recover_stranded_episodes

        ep = self._make_episode("embedding", "ep-1")
        db = self._setup_db([ep])

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.job_queue.enqueue") as mock_enqueue:
            result = recover_stranded_episodes()

        assert result["recovered"] == 1
        assert ep.status == "pending"
        mock_enqueue.assert_called_once_with(db, "ep-1", "embed")
        db.commit.assert_called_once()

    def test_handles_progress_tagged_downloading(self):
        from app.tasks.cleanup import recover_stranded_episodes

        ep = self._make_episode("downloading:42%", "ep-1")
        db = self._setup_db([ep])

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.job_queue.enqueue") as mock_enqueue:
            recover_stranded_episodes()

        assert ep.status == "pending"
        mock_enqueue.assert_called_once_with(db, "ep-1", "download")

    def test_skips_unknown_status_without_enqueueing(self):
        """An unmappable status should be reported, not retried at random."""
        from app.tasks.cleanup import recover_stranded_episodes

        ep = self._make_episode("frobnicating", "ep-weird")
        db = self._setup_db([ep])

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.job_queue.enqueue") as mock_enqueue:
            result = recover_stranded_episodes()

        assert result["recovered"] == 0
        assert result["unmapped"] == 1
        assert result["unmapped_ids"] == ["ep-weird"]
        assert result["unmapped_statuses"] == ["frobnicating"]
        mock_enqueue.assert_not_called()
        # Status preserved: don't silently mutate something we don't understand.
        assert ep.status == "frobnicating"

    def test_no_stranded_episodes_does_not_commit(self):
        from app.tasks.cleanup import recover_stranded_episodes

        db = self._setup_db([])

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.job_queue.enqueue") as mock_enqueue:
            result = recover_stranded_episodes()

        assert result["recovered"] == 0
        mock_enqueue.assert_not_called()
        db.commit.assert_not_called()

    def test_handles_multiple_strandings_in_one_pass(self):
        from app.tasks.cleanup import recover_stranded_episodes

        eps = [
            self._make_episode("embedding", "ep-1"),
            self._make_episode("inferring", "ep-2"),
            self._make_episode("archiving", "ep-3"),
        ]
        db = self._setup_db(eps)

        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.job_queue.enqueue") as mock_enqueue:
            result = recover_stranded_episodes()

        assert result["recovered"] == 3
        assert sorted(result["recovered_ids"]) == ["ep-1", "ep-2", "ep-3"]
        enqueued_tasks = [c.args[2] for c in mock_enqueue.call_args_list]
        assert enqueued_tasks == ["embed", "infer", "archive"]

    def test_rolls_back_and_reraises_on_exception(self):
        from app.tasks.cleanup import recover_stranded_episodes

        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.all.side_effect = (
            RuntimeError("db gone")
        )

        with patch("app.database.SessionLocal", return_value=db):
            with pytest.raises(RuntimeError, match="db gone"):
                recover_stranded_episodes()

        db.rollback.assert_called_once()
        db.close.assert_called_once()
