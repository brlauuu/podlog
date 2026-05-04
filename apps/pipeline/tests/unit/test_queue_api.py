"""Tests for the queue API: retry logic + dashboard read (#555)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.queue import NON_RETRYABLE, TASK_TO_STATUS, get_queue, retry_job
from app.models import Episode, Job


def _make_episode(status, **kwargs):
    """Create a mock Episode with required fields."""
    ep = MagicMock()
    ep.id = kwargs.get("id", "ep-1")
    ep.title = kwargs.get("title", "Test Episode")
    ep.status = status
    ep.error_message = kwargs.get("error_message", None)
    ep.error_class = kwargs.get("error_class", None)
    ep.retry_count = kwargs.get("retry_count", 0)
    ep.retry_max = kwargs.get("retry_max", 3)
    ep.transcribe_duration_secs = kwargs.get("transcribe_duration_secs", None)
    ep.diarize_duration_secs = kwargs.get("diarize_duration_secs", None)
    ep.diarize_step_durations = kwargs.get("diarize_step_durations", None)
    ep.updated_at = kwargs.get("updated_at", None)
    ep.feed = MagicMock()
    ep.feed.mode = kwargs.get("feed_mode", "live")
    ep.feed.title = kwargs.get("feed_title", "Test Feed")
    return ep


class TestNonRetryable:
    def test_disk_full_is_non_retryable(self):
        assert "DISK_FULL" in NON_RETRYABLE

    def test_oom_is_non_retryable(self):
        assert "OOM" in NON_RETRYABLE

    def test_manual_upload_file_missing_is_non_retryable(self):
        # #650: clicking Retry without re-uploading the file would just
        # re-issue the same MANUAL_UPLOAD_FILE_MISSING terminal failure.
        assert "MANUAL_UPLOAD_FILE_MISSING" in NON_RETRYABLE


class TestRetryJob:
    """Tests for the retry endpoint guard logic (issue #46)."""

    def _call_retry(self, episode, has_active_job=False):
        """Call retry_job with a mocked DB that returns the given episode."""
        from fastapi import HTTPException

        db = MagicMock()

        # db.query(Episode).filter(...).first() returns the episode
        # db.query(Job).filter(...).first() returns None (no active job) or a mock
        def query_side_effect(model):
            chain = MagicMock()
            if model is Episode:
                chain.filter.return_value.first.return_value = episode
            elif model is Job:
                chain.filter.return_value.first.return_value = MagicMock() if has_active_job else None
            return chain

        db.query.side_effect = query_side_effect
        try:
            with patch("app.api.queue.enqueue_episode_ingest"):
                return retry_job("ep-1", db=db)
        except HTTPException as exc:
            return exc

    def test_retry_failed_episode_succeeds(self):
        ep = _make_episode(
            "failed",
            error_class="TRANSIENT_NETWORK",
            retry_count=3,
            transcribe_duration_secs=120.0,
            diarize_duration_secs=60.0,
            diarize_step_durations={"provider_diarization_secs": 40.0},
        )
        result = self._call_retry(ep)
        assert result["queued"] is True
        assert ep.retry_count == 0
        assert ep.transcribe_duration_secs is None
        assert ep.diarize_duration_secs is None
        assert ep.diarize_step_durations is None

    def test_retry_stalled_episode_with_error_class_succeeds(self):
        """Stalled jobs with error_class set should be retryable (issue #46)."""
        ep = _make_episode("diarizing", error_class="SYSTEM_ERROR", error_message="Worker killed")
        result = self._call_retry(ep)
        assert result["queued"] is True

    def test_retry_done_episode_succeeds(self):
        """Done episodes (e.g. with diarization failure) should be reprocessable."""
        ep = _make_episode("done")
        result = self._call_retry(ep)
        assert result["queued"] is True

    def test_retry_active_episode_without_error_rejected(self):
        """Active jobs with a queue entry should not be retryable."""
        ep = _make_episode("diarizing", error_class=None)
        result = self._call_retry(ep, has_active_job=True)
        assert result.status_code == 409

    def test_retry_non_retryable_error_rejected(self):
        """Jobs with DISK_FULL or OOM should not be retryable."""
        ep = _make_episode("failed", error_class="DISK_FULL")
        result = self._call_retry(ep)
        assert result.status_code == 422

    def test_retry_done_non_retryable_rejected(self):
        """Done episodes with non-retryable error class should still be rejected."""
        ep = _make_episode("done", error_class="DISK_FULL")
        result = self._call_retry(ep)
        assert result.status_code == 422

    def test_retry_stuck_episode_no_queue_entry_succeeds(self):
        """Stuck episodes (intermediate status, no queue entry) should be retryable."""
        ep = _make_episode("archiving")
        result = self._call_retry(ep, has_active_job=False)
        assert result["queued"] is True

    def test_retry_active_episode_with_queue_entry_rejected(self):
        """Episodes with an active queue entry should not be retryable."""
        ep = _make_episode("transcribing")
        result = self._call_retry(ep, has_active_job=True)
        assert result.status_code == 409

    def test_retry_manual_upload_routes_to_transcribe_not_download(self, tmp_path):
        # #650: ensure the queue retry endpoint integrates with
        # enqueue_episode_ingest's manual-upload routing. Without this test,
        # someone could rewrite enqueue_episode_ingest's call site (or
        # patching boundary) and the regression in TestEnqueueEpisodeIngest
        # alone wouldn't catch it. We deliberately do NOT patch
        # enqueue_episode_ingest here.
        from app.api.queue import retry_job

        local_file = tmp_path / "abc.mp4"
        local_file.write_bytes(b"audio")
        ep = _make_episode("failed", error_class="TRANSIENT_NETWORK")
        # _make_episode doesn't model audio_url / audio_local_path; set them
        # directly on the MagicMock so _is_manual_upload classifies this row.
        ep.audio_url = "local://Đorđe_and_Lara_talk.mp4"
        ep.audio_local_path = str(local_file)

        db = MagicMock()

        def query_side_effect(model):
            chain = MagicMock()
            if model is Episode:
                chain.filter.return_value.first.return_value = ep
            elif model is Job:
                chain.filter.return_value.first.return_value = None
            return chain

        db.query.side_effect = query_side_effect

        with patch("app.services.pipeline_commands.job_queue.enqueue") as mock_enqueue:
            retry_job("ep-1", db=db)

        # Exactly one enqueue call, and it must be for `transcribe` — not
        # `download`, which would feed the local:// URL through httpx.
        mock_enqueue.assert_called_once()
        args, kwargs = mock_enqueue.call_args
        assert args[2] == "transcribe", f"expected transcribe, got {args[2]!r}"


def _classify(sql_text: str) -> str:
    """Route a queue SQL string to its dashboard bucket.

    Order matters: check for the most specific markers first because the
    stuck / count queries both mention 'done' and 'failed' as literals.
    """
    if "COUNT(*) AS count" in sql_text:
        return "done_count"
    if "jq.status = 'picked'" in sql_text:
        return "active"
    if "jq.status = 'pending'" in sql_text:
        return "pending"
    if "jq.status IN ('pending', 'picked')" in sql_text:
        return "stuck"
    if "LIMIT 50" in sql_text:
        return "done"
    if "WHERE e.status = 'failed'" in sql_text:
        return "failed"
    return "unknown"


def _mock_execute(rows_by_bucket: dict[str, list[dict]], done_count: int = 0):
    """Build a side_effect that routes db.execute(text(sql)) by bucket name."""
    def side_effect(stmt):
        bucket = _classify(str(stmt))
        result = MagicMock()
        if bucket == "done_count":
            result.scalar_one.return_value = done_count
            return result
        rows = rows_by_bucket.get(bucket, [])
        result.all.return_value = [
            SimpleNamespace(_mapping=dict(row)) for row in rows  # type: ignore[arg-type]
        ]
        return result
    return side_effect


class TestGetQueue:
    def test_empty_queue_returns_zero_counts(self):
        db = MagicMock()
        db.execute.side_effect = _mock_execute({}, done_count=0)

        payload = get_queue(db=db)

        assert payload["active_count"] == 0
        assert payload["pending_count"] == 0
        assert payload["failed_count"] == 0
        assert payload["done_count"] == 0
        assert payload["stuck_count"] == 0
        assert payload["active_jobs"] == []
        assert payload["pending_jobs"] == []
        assert payload["failed_jobs"] == []
        assert payload["done_jobs"] == []
        assert payload["stuck_jobs"] == []

    def test_active_rows_get_task_mapped_to_display_status(self):
        db = MagicMock()
        db.execute.side_effect = _mock_execute(
            {
                "active": [
                    {"episode_id": "ep-1", "active_task": "transcribe", "title": "T1"},
                    {"episode_id": "ep-2", "active_task": "diarize", "title": "T2"},
                ]
            }
        )

        payload = get_queue(db=db)

        assert payload["active_count"] == 2
        assert [j["status"] for j in payload["active_jobs"]] == ["transcribing", "diarizing"]

    def test_active_task_falls_back_to_raw_name_when_unmapped(self):
        db = MagicMock()
        db.execute.side_effect = _mock_execute(
            {
                "active": [
                    {"episode_id": "ep-x", "active_task": "custom_task", "title": "X"},
                ]
            }
        )

        payload = get_queue(db=db)

        assert payload["active_jobs"][0]["status"] == "custom_task"

    def test_pending_and_stuck_rows_are_tagged_with_literal_statuses(self):
        db = MagicMock()
        db.execute.side_effect = _mock_execute(
            {
                "pending": [
                    {"episode_id": "ep-p", "pending_task": "transcribe", "title": "P"}
                ],
                "stuck": [
                    {"episode_id": "ep-s", "status": "downloading:100", "title": "S"}
                ],
            }
        )

        payload = get_queue(db=db)

        assert payload["pending_count"] == 1
        assert payload["pending_jobs"][0]["status"] == "pending"
        assert payload["stuck_count"] == 1
        assert payload["stuck_jobs"][0]["status"] == "stuck"

    def test_failed_and_done_rows_pass_through_with_done_count(self):
        db = MagicMock()
        db.execute.side_effect = _mock_execute(
            {
                "failed": [
                    {"episode_id": "ep-f", "title": "F", "status": "failed",
                     "error_message": "HTTP 404"},
                ],
                "done": [
                    {"episode_id": "ep-d", "title": "D", "status": "done"},
                ],
            },
            done_count=1234,
        )

        payload = get_queue(db=db)

        assert payload["failed_count"] == 1
        assert payload["failed_jobs"][0]["error_message"] == "HTTP 404"
        assert payload["done_count"] == 1234
        assert isinstance(payload["done_count"], int)
        assert payload["done_jobs"][0]["episode_id"] == "ep-d"


class TestTaskToStatusMap:
    def test_covers_every_pipeline_task(self):
        # If a new task stage is added to job_queue, this guard reminds us to
        # teach the dashboard how to display it.
        assert TASK_TO_STATUS == {
            "download": "downloading",
            "transcribe": "transcribing",
            "diarize": "diarizing",
            "embed": "embedding",
            "infer": "inferring",
            "archive": "archiving",
        }
