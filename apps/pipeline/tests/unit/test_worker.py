"""Unit tests for app.worker — DB-backed job worker."""
import signal
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call

import pytest


class TestResolveHandler:
    def test_resolves_known_module(self):
        from app.worker import _resolve_handler

        handler = _resolve_handler("app.tasks.chunk:chunk_episode")
        from app.tasks.chunk import chunk_episode

        assert handler is chunk_episode

    def test_raises_on_bad_path(self):
        from app.worker import _resolve_handler

        with pytest.raises(ModuleNotFoundError):
            _resolve_handler("nonexistent.module:func")


class TestHandleSignal:
    def test_sets_shutdown_flag(self):
        import app.worker as w

        w._shutdown = False
        w._handle_signal(signal.SIGTERM, None)
        assert w._shutdown is True
        w._shutdown = False  # reset


class TestRunPeriodicTasks:
    @patch("app.worker._resolve_handler")
    @patch("app.worker.settings")
    def test_runs_task_when_due(self, mock_settings, mock_resolve):
        mock_settings.feed_poll_interval_hours = 1
        mock_handler = MagicMock()
        mock_resolve.return_value = mock_handler

        from app.worker import _run_periodic_tasks

        last_run = {}
        now = datetime.now(timezone.utc)
        _run_periodic_tasks(last_run, now)

        assert mock_handler.call_count >= 1
        assert len(last_run) > 0


class TestValidateWorkerWiring:
    @patch("app.worker._resolve_handler")
    def test_valid_wiring_passes(self, mock_resolve):
        mock_resolve.return_value = MagicMock()

        from app.worker import _validate_worker_wiring

        _validate_worker_wiring()

    @patch("app.worker._resolve_handler")
    def test_invalid_task_handler_raises(self, mock_resolve):
        def fake_resolve(path: str):
            if path == "app.tasks.chunk:chunk_episode":
                raise ModuleNotFoundError("broken")
            return MagicMock()

        mock_resolve.side_effect = fake_resolve

        from app.worker import _validate_worker_wiring

        with pytest.raises(RuntimeError, match="Invalid worker registry wiring"):
            _validate_worker_wiring()

    @patch("app.worker._resolve_handler")
    def test_non_callable_handler_raises(self, mock_resolve):
        def fake_resolve(path: str):
            if path == "app.tasks.chunk:chunk_episode":
                return object()
            return MagicMock()

        mock_resolve.side_effect = fake_resolve

        from app.worker import _validate_worker_wiring

        with pytest.raises(RuntimeError, match="not callable"):
            _validate_worker_wiring()

    @patch("app.worker._resolve_handler")
    @patch("app.worker.settings")
    def test_skips_task_when_not_due(self, mock_settings, mock_resolve):
        mock_settings.feed_poll_interval_hours = 1
        mock_handler = MagicMock()
        mock_resolve.return_value = mock_handler

        from app.worker import _run_periodic_tasks, PERIODIC_TASKS

        now = datetime.now(timezone.utc)
        last_run = {name: now for name, _, _ in PERIODIC_TASKS}

        mock_handler.reset_mock()
        _run_periodic_tasks(last_run, now)

        mock_handler.assert_not_called()

    @patch("app.worker._resolve_handler")
    @patch("app.worker.settings")
    def test_failure_still_updates_last_run(self, mock_settings, mock_resolve):
        mock_settings.feed_poll_interval_hours = 1
        mock_resolve.return_value = MagicMock(side_effect=RuntimeError("boom"))

        from app.worker import _run_periodic_tasks

        last_run = {}
        now = datetime.now(timezone.utc)
        _run_periodic_tasks(last_run, now)

        # Should still mark as run to avoid immediate retry
        assert len(last_run) > 0


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
    def test_processes_job_and_stops(self, mock_register, mock_bus, mock_signal,
                                     mock_session_cls, mock_jq, mock_periodic, mock_time):
        import app.worker as w

        # Set up: one job found, then shutdown
        job = MagicMock()
        job.id = 1
        job.task = "chunk"
        job.episode_id = "ep1"

        db = MagicMock()
        mock_session_cls.return_value = db
        mock_jq.poll.return_value = job

        # Stop after first iteration
        call_count = 0
        original_shutdown = w._shutdown

        def stop_after_one(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                w._shutdown = True

        mock_jq.complete.side_effect = stop_after_one

        with patch("app.worker._resolve_handler") as mock_resolve:
            mock_handler = MagicMock()
            mock_resolve.return_value = mock_handler

            w._shutdown = False
            w.main()

        mock_handler.assert_called_once_with("ep1")
        mock_jq.complete.assert_called_once_with(db, job)
        w._shutdown = original_shutdown

    @patch("app.worker.time")
    @patch("app.worker._run_periodic_tasks")
    @patch("app.worker.job_queue")
    @patch("app.worker.SessionLocal")
    @patch("app.worker.signal")
    @patch("app.services.events.bus")
    @patch("app.services.digest.register_notification_handlers")
    def test_unknown_task_fails_job(self, mock_register, mock_bus, mock_signal,
                                    mock_session_cls, mock_jq, mock_periodic, mock_time):
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
    def test_handler_exception_fails_job(self, mock_register, mock_bus, mock_signal,
                                          mock_session_cls, mock_jq, mock_periodic, mock_time):
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

        with patch("app.worker._resolve_handler") as mock_resolve:
            mock_resolve.return_value = MagicMock(side_effect=RuntimeError("task crash"))

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
    def test_no_job_sleeps(self, mock_register, mock_bus, mock_signal,
                            mock_session_cls, mock_jq, mock_periodic, mock_time):
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
