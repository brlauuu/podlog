"""Unit tests for app.worker — DB-backed job worker."""
import signal
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest


class TestHandleSignal:
    def test_sets_shutdown_flag(self):
        import app.worker as w

        w._shutdown = False
        w._handle_signal(signal.SIGTERM, None)
        assert w._shutdown is True
        w._shutdown = False  # reset


class TestWorkerRegistry:
    def test_worker_registries_are_callable(self):
        import app.worker as w

        for name, handler in w.TASK_HANDLERS.items():
            assert callable(handler), f"task handler for {name} is not callable"

        for name, handler, _ in w.PERIODIC_TASKS:
            assert callable(handler), f"periodic handler for {name} is not callable"

    def test_validate_worker_wiring_raises_for_non_callable_task(self):
        import app.worker as w

        with patch.dict(w.TASK_HANDLERS, {"chunk": object()}):
            with pytest.raises(RuntimeError, match="Invalid worker registry wiring"):
                w._validate_worker_wiring()

    def test_validate_worker_wiring_raises_for_non_callable_periodic(self):
        import app.worker as w

        with patch.object(w, "PERIODIC_TASKS", [("poll_all_feeds", object(), None)]):
            with pytest.raises(RuntimeError, match="Invalid worker registry wiring"):
                w._validate_worker_wiring()


class TestRunPeriodicTasks:
    @patch("app.worker.settings")
    def test_runs_task_when_due(self, mock_settings):
        import app.worker as w

        mock_settings.feed_poll_interval_hours = 1
        mock_handler = MagicMock()
        with patch.object(w, "PERIODIC_TASKS", [("poll_all_feeds", mock_handler, None)]):
            last_run = {}
            now = datetime.now(timezone.utc)
            w._run_periodic_tasks(last_run, now)

        mock_handler.assert_called_once()
        assert "poll_all_feeds" in last_run

    @patch("app.worker.settings")
    def test_skips_task_when_not_due(self, mock_settings):
        import app.worker as w

        mock_settings.feed_poll_interval_hours = 1
        mock_handler = MagicMock()
        with patch.object(w, "PERIODIC_TASKS", [("poll_all_feeds", mock_handler, None)]):
            now = datetime.now(timezone.utc)
            last_run = {"poll_all_feeds": now - timedelta(minutes=30)}
            w._run_periodic_tasks(last_run, now)

        mock_handler.assert_not_called()

    @patch("app.worker.settings")
    def test_failure_still_updates_last_run(self, mock_settings):
        import app.worker as w

        mock_settings.feed_poll_interval_hours = 1
        crashing_handler = MagicMock(side_effect=RuntimeError("boom"))
        with patch.object(w, "PERIODIC_TASKS", [("poll_all_feeds", crashing_handler, None)]):
            last_run = {}
            now = datetime.now(timezone.utc)
            w._run_periodic_tasks(last_run, now)

        # Should still mark as run to avoid immediate retry
        assert "poll_all_feeds" in last_run


class TestMainLoop:
    @patch("app.worker._validate_worker_wiring")
    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_startup_validation_failure_stops_main(
        self,
        mock_register,
        mock_bus,
        mock_signal,
        mock_session_cls,
        mock_jq,
        mock_periodic,
        mock_time,
        mock_validate,
    ):
        import app.worker as w

        mock_validate.side_effect = RuntimeError("bad wiring")

        with pytest.raises(RuntimeError, match="bad wiring"):
            w.main()

        mock_jq.poll.assert_not_called()

    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_processes_job_and_stops(
        self,
        mock_register,
        mock_bus,
        mock_signal,
        mock_session_cls,
        mock_jq,
        mock_periodic,
        mock_time,
    ):
        import app.worker as w

        job = MagicMock()
        job.id = 1
        job.task = "chunk"
        job.episode_id = "ep1"

        db = MagicMock()
        mock_session_cls.return_value = db
        mock_jq.poll.return_value = job

        def stop_after_one(*args, **kwargs):
            w._shutdown = True

        mock_jq.complete.side_effect = stop_after_one
        mock_handler = MagicMock()

        with patch.dict(w.TASK_HANDLERS, {"chunk": mock_handler}, clear=False):
            w._shutdown = False
            w.main()

        mock_handler.assert_called_once_with("ep1")
        mock_jq.complete.assert_called_once_with(db, job)

    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_unknown_task_fails_job(
        self,
        mock_register,
        mock_bus,
        mock_signal,
        mock_session_cls,
        mock_jq,
        mock_periodic,
        mock_time,
    ):
        import app.worker as w

        job = MagicMock()
        job.id = 1
        job.task = "nonexistent_task"
        job.episode_id = "ep1"

        db = MagicMock()
        mock_session_cls.return_value = db
        mock_jq.poll.return_value = job

        def stop(*args, **kwargs):
            w._shutdown = True

        mock_jq.fail.side_effect = stop

        w._shutdown = False
        w.main()

        mock_jq.fail.assert_called_once()
        assert "Unknown task" in str(mock_jq.fail.call_args)

    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_handler_exception_fails_job(
        self,
        mock_register,
        mock_bus,
        mock_signal,
        mock_session_cls,
        mock_jq,
        mock_periodic,
        mock_time,
    ):
        import app.worker as w

        job = MagicMock()
        job.id = 1
        job.task = "chunk"
        job.episode_id = "ep1"

        db = MagicMock()
        mock_session_cls.return_value = db
        mock_jq.poll.return_value = job

        def stop(*args, **kwargs):
            w._shutdown = True

        mock_jq.fail.side_effect = stop
        crashing_handler = MagicMock(side_effect=RuntimeError("task crash"))

        with patch.dict(w.TASK_HANDLERS, {"chunk": crashing_handler}, clear=False):
            w._shutdown = False
            w.main()

        mock_jq.fail.assert_called_once()

    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_no_job_sleeps(
        self,
        mock_register,
        mock_bus,
        mock_signal,
        mock_session_cls,
        mock_jq,
        mock_periodic,
        mock_time,
    ):
        import app.worker as w

        db = MagicMock()
        mock_session_cls.return_value = db
        mock_jq.poll.return_value = None

        def stop(*args, **kwargs):
            w._shutdown = True

        mock_time.sleep.side_effect = stop

        w._shutdown = False
        w.main()

        mock_time.sleep.assert_called_once_with(2)
