"""Unit tests for app.worker and app.task_registry."""
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
        w._shutdown = False


class TestTaskRegistry:
    def test_resolves_known_module(self):
        from app.task_registry import _resolve
        from app.tasks.chunk import chunk_episode

        assert _resolve("app.tasks.chunk:chunk_episode") is chunk_episode

    def test_raises_on_bad_path(self):
        from app.task_registry import _resolve

        with pytest.raises(ModuleNotFoundError):
            _resolve("nonexistent.module:func")

    def test_task_handlers_are_callable(self):
        from app.task_registry import TASK_HANDLERS

        for name, handler in TASK_HANDLERS.items():
            assert callable(handler), f"task handler for {name} is not callable"

    def test_periodic_tasks_are_runnable(self):
        from app.task_registry import PERIODIC_TASKS

        for task in PERIODIC_TASKS:
            assert callable(task.run), f"periodic task {task.name} is not runnable"

    def test_validate_wiring_raises_for_broken_import(self):
        from app.task_registry import validate_wiring

        with patch("app.task_registry._resolve") as mock_resolve:
            def side_effect(path: str):
                if path == "app.tasks.chunk:chunk_episode":
                    raise ModuleNotFoundError("broken import")
                return MagicMock()

            mock_resolve.side_effect = side_effect

            with pytest.raises(RuntimeError, match="Invalid worker registry wiring"):
                validate_wiring()


class TestRunPeriodicTasks:
    @patch("app.task_registry.settings")
    def test_runs_task_when_due(self, mock_settings):
        import app.worker as w
        from app.task_registry import PeriodicTask

        mock_settings.feed_poll_interval_hours = 1
        mock_run = MagicMock()
        task = PeriodicTask("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None)
        task.run = mock_run

        with patch.object(w, "PERIODIC_TASKS", [task]):
            last_run = {}
            now = datetime.now(timezone.utc)
            w._run_periodic_tasks(last_run, now)

        mock_run.assert_called_once()
        assert "poll_all_feeds" in last_run

    @patch("app.task_registry.settings")
    def test_skips_task_when_not_due(self, mock_settings):
        import app.worker as w
        from app.task_registry import PeriodicTask

        mock_settings.feed_poll_interval_hours = 1
        mock_run = MagicMock()
        task = PeriodicTask("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None)
        task.run = mock_run

        with patch.object(w, "PERIODIC_TASKS", [task]):
            now = datetime.now(timezone.utc)
            last_run = {"poll_all_feeds": now - timedelta(minutes=30)}
            w._run_periodic_tasks(last_run, now)

        mock_run.assert_not_called()

    @patch("app.task_registry.settings")
    def test_failure_still_updates_last_run(self, mock_settings):
        import app.worker as w
        from app.task_registry import PeriodicTask

        mock_settings.feed_poll_interval_hours = 1
        task = PeriodicTask("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None)
        task.run = MagicMock(side_effect=RuntimeError("boom"))

        with patch.object(w, "PERIODIC_TASKS", [task]):
            last_run = {}
            now = datetime.now(timezone.utc)
            w._run_periodic_tasks(last_run, now)

        assert "poll_all_feeds" in last_run


class TestMainLoop:
    @patch("app.worker.validate_wiring")
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
