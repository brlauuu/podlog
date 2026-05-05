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


# ---------------------------------------------------------------------------
# Issue #641: worker-loop transient retry classification
# ---------------------------------------------------------------------------


class TestIsTransient:
    def test_httpx_network_error_is_transient(self):
        import httpx
        from app.worker import _is_transient

        assert _is_transient(httpx.NetworkError("connection reset")) is True

    def test_httpx_timeout_is_transient(self):
        import httpx
        from app.worker import _is_transient

        assert _is_transient(httpx.ConnectTimeout("timed out")) is True

    def test_oserror_with_unreachable_text_is_transient(self):
        """The original embed-task strand: plain OSError with 'Network is unreachable'."""
        from app.worker import _is_transient

        assert _is_transient(OSError("[Errno 101] Network is unreachable")) is True

    def test_dns_failure_is_transient(self):
        import socket
        from app.worker import _is_transient

        assert _is_transient(socket.gaierror("nodename nor servname provided")) is True

    def test_connection_refused_text_is_transient(self):
        from app.worker import _is_transient

        assert _is_transient(RuntimeError("Connection refused upstream")) is True

    def test_value_error_is_not_transient(self):
        from app.worker import _is_transient

        assert _is_transient(ValueError("bad input")) is False

    def test_assertion_error_is_not_transient(self):
        from app.worker import _is_transient

        assert _is_transient(AssertionError("invariant broken")) is False


class TestClassifyForRetry:
    """Issue #653: richer classification including typed metadata, MemoryError,
    and HTTPStatusError."""

    def test_typed_exception_with_retryable_metadata_wins(self):
        """An exception carrying ``retryable`` and ``error_class`` attrs (e.g.
        FireworksTranscriptionError) overrides everything else."""
        from app.worker import _classify_for_retry

        class TypedError(RuntimeError):
            def __init__(self, msg, retryable, error_class):
                super().__init__(msg)
                self.retryable = retryable
                self.error_class = error_class

        retryable, ec = _classify_for_retry(
            TypedError("bad upload", retryable=True, error_class="FIREWORKS_UPLOAD_REJECTED")
        )
        assert (retryable, ec) == (True, "FIREWORKS_UPLOAD_REJECTED")

        retryable, ec = _classify_for_retry(
            TypedError("permanent denial", retryable=False, error_class="HTTP_ACCESS")
        )
        assert (retryable, ec) == (False, "HTTP_ACCESS")

    def test_memory_error_is_terminal_oom(self):
        """transcribe.py used to mark this OOM internally; worker takes over."""
        from app.worker import _classify_for_retry

        assert _classify_for_retry(MemoryError("out of memory")) == (False, "OOM")

    def test_httpx_5xx_is_transient_network(self):
        """download.py used to retry 5xx as TRANSIENT_NETWORK; preserve that."""
        import httpx
        from app.worker import _classify_for_retry

        for status in (500, 502, 503, 504):
            req = httpx.Request("GET", "https://example.com/x")
            resp = httpx.Response(status, request=req)
            err = httpx.HTTPStatusError(f"HTTP {status}", request=req, response=resp)
            assert _classify_for_retry(err) == (True, "TRANSIENT_NETWORK"), f"status={status}"

    def test_httpx_429_is_transient_network(self):
        """Rate-limit responses retry as TRANSIENT_NETWORK."""
        import httpx
        from app.worker import _classify_for_retry

        req = httpx.Request("GET", "https://example.com/x")
        resp = httpx.Response(429, request=req)
        err = httpx.HTTPStatusError("HTTP 429", request=req, response=resp)
        assert _classify_for_retry(err) == (True, "TRANSIENT_NETWORK")

    def test_httpx_4xx_is_retryable_http_access(self):
        """Preserve download.py's pre-#653 behavior of retrying 4xx as HTTP_ACCESS."""
        import httpx
        from app.worker import _classify_for_retry

        for status in (400, 403, 404, 410):
            req = httpx.Request("GET", "https://example.com/x")
            resp = httpx.Response(status, request=req)
            err = httpx.HTTPStatusError(f"HTTP {status}", request=req, response=resp)
            assert _classify_for_retry(err) == (True, "HTTP_ACCESS"), f"status={status}"

    def test_value_error_is_terminal_system_error(self):
        from app.worker import _classify_for_retry

        assert _classify_for_retry(ValueError("nope")) == (False, "SYSTEM_ERROR")


class TestHandleTaskException:
    def _setup(self, *, retry_count=0, retry_max=3, status="embedding", episode_id="ep-1"):
        episode = MagicMock()
        episode.id = episode_id
        episode.retry_count = retry_count
        episode.retry_max = retry_max
        episode.status = status
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = episode
        job = MagicMock()
        job.episode_id = episode_id
        job.task = "embed"
        return db, job, episode

    @patch("app.worker.job_queue")
    @patch("app.worker.update_episode")
    @patch("app.worker.mark_failed")
    @patch("app.worker.settings")
    def test_transient_under_budget_enqueues_retry(self, mock_settings, mock_fail, mock_update, mock_jq):
        from app.worker import _handle_task_exception

        mock_settings.retry_max = 3
        mock_settings.retry_backoff_base = 30
        db, job, episode = self._setup(retry_count=0, retry_max=3, status="embedding")

        _handle_task_exception(db, job, OSError("[Errno 101] Network is unreachable"))

        # Retry path: episode reset to pending, retry_count bumped, fresh job enqueued.
        assert mock_update.call_args.args[:2] == (db, "ep-1")
        kwargs = mock_update.call_args.kwargs
        assert kwargs["status"] == "pending"
        assert kwargs["retry_count"] == 1
        assert kwargs["error_class"] == "TRANSIENT_NETWORK"
        mock_jq.enqueue.assert_called_once()
        enqueue_args = mock_jq.enqueue.call_args
        assert enqueue_args.args[2] == "embed"  # same task, not next stage
        assert enqueue_args.kwargs["retry_at"] is not None
        # The original job is still recorded as failed (historical attempt).
        mock_jq.fail.assert_called_once_with(db, job, "[Errno 101] Network is unreachable")
        # Terminal-failure notification did NOT fire on the retry path.
        mock_fail.assert_not_called()

    @patch("app.worker.job_queue")
    @patch("app.worker.update_episode")
    @patch("app.worker.mark_failed")
    @patch("app.worker.settings")
    def test_transient_at_budget_marks_failed(self, mock_settings, mock_fail, mock_update, mock_jq):
        from app.worker import _handle_task_exception

        mock_settings.retry_max = 3
        mock_settings.retry_backoff_base = 30
        db, job, episode = self._setup(retry_count=3, retry_max=3, status="embedding")

        _handle_task_exception(db, job, OSError("[Errno 101] Network is unreachable"))

        # No retry: budget exhausted. Episode marked failed + job marked failed.
        mock_jq.enqueue.assert_not_called()
        mock_fail.assert_called_once()
        assert mock_fail.call_args.kwargs["error_class"] == "TRANSIENT_NETWORK"
        assert "Failed after 3 retries" in mock_fail.call_args.kwargs["error_message"]
        mock_jq.fail.assert_called_once()

    @patch("app.worker.job_queue")
    @patch("app.worker.update_episode")
    @patch("app.worker.mark_failed")
    @patch("app.worker.settings")
    def test_non_transient_marks_failed_immediately(self, mock_settings, mock_fail, mock_update, mock_jq):
        from app.worker import _handle_task_exception

        mock_settings.retry_max = 3
        mock_settings.retry_backoff_base = 30
        db, job, episode = self._setup(retry_count=0, retry_max=3, status="embedding")

        _handle_task_exception(db, job, ValueError("malformed audio metadata"))

        mock_jq.enqueue.assert_not_called()
        mock_fail.assert_called_once()
        assert mock_fail.call_args.kwargs["error_class"] == "SYSTEM_ERROR"
        assert "Unhandled error in embed" in mock_fail.call_args.kwargs["error_message"]
        mock_jq.fail.assert_called_once()

    @patch("app.worker.job_queue")
    @patch("app.worker.update_episode")
    @patch("app.worker.mark_failed")
    def test_episode_already_failed_only_records_job(self, mock_fail, mock_update, mock_jq):
        """If a task pre-marked the episode failed (e.g. DISK_FULL in download.py),
        the worker should not double-handle — just record this job as failed."""
        from app.worker import _handle_task_exception

        db, job, episode = self._setup(status="failed")

        _handle_task_exception(db, job, RuntimeError("already failed"))

        mock_update.assert_not_called()
        mock_fail.assert_not_called()
        mock_jq.enqueue.assert_not_called()
        mock_jq.fail.assert_called_once()

    @patch("app.worker.job_queue")
    @patch("app.worker.update_episode")
    @patch("app.worker.mark_failed")
    def test_episode_missing_only_records_job(self, mock_fail, mock_update, mock_jq):
        """If the episode row was deleted between job pickup and exception,
        we still record the job as failed but skip episode mutations."""
        from app.worker import _handle_task_exception

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None  # episode gone
        job = MagicMock()
        job.episode_id = "ep-missing"
        job.task = "embed"

        _handle_task_exception(db, job, RuntimeError("orphaned"))

        mock_update.assert_not_called()
        mock_fail.assert_not_called()
        mock_jq.enqueue.assert_not_called()
        mock_jq.fail.assert_called_once_with(db, job, "orphaned")
