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


class TestBulkRetryUploadRejected:
    """Issue #610: bulk-retry for episodes that hit Fireworks's upload cap."""

    def _make_db_with_episodes(self, episodes):
        """Build a mock DB whose query(Episode).filter(...).all() returns episodes."""
        db = MagicMock()
        chain = MagicMock()
        chain.filter.return_value = chain
        chain.all.return_value = episodes
        db.query.return_value = chain
        return db

    def test_preview_returns_count_minutes_and_cost(self):
        from app.api.queue import preview_bulk_retry_upload_rejected

        ep = _make_episode(
            "failed",
            error_class="FIREWORKS_UPLOAD_REJECTED",
            error_message="Fireworks rejected the upload",
        )
        ep.duration_secs = 8400  # 140 min
        db = self._make_db_with_episodes([ep])

        with patch(
            "app.services.notification_settings.get_runtime_inference_settings",
            return_value={
                "fireworks_chunked_transcription_enabled": True,
                "fireworks_stt_cost_per_minute_usd": 0.006,
            },
        ):
            result = preview_bulk_retry_upload_rejected(db=db)

        assert result["eligible_count"] == 1
        assert result["total_minutes"] == 140.0
        assert result["estimated_cost_usd"] == round(140.0 * 0.006, 2)
        assert result["chunked_enabled"] is True

    def test_preview_chunked_enabled_false_when_toggle_off(self):
        from app.api.queue import preview_bulk_retry_upload_rejected

        ep = _make_episode("failed", error_class="FIREWORKS_UPLOAD_REJECTED")
        ep.duration_secs = 3600
        db = self._make_db_with_episodes([ep])

        with patch(
            "app.services.notification_settings.get_runtime_inference_settings",
            return_value={
                "fireworks_chunked_transcription_enabled": False,
                "fireworks_stt_cost_per_minute_usd": 0.006,
            },
        ):
            result = preview_bulk_retry_upload_rejected(db=db)

        assert result["chunked_enabled"] is False

    def test_post_refuses_when_chunked_transcription_is_disabled(self):
        """Refuses with 422 if the toggle is off — retrying without chunking
        would just hit the cap again."""
        from fastapi import HTTPException

        from app.api.queue import bulk_retry_upload_rejected

        db = self._make_db_with_episodes([])

        with patch(
            "app.services.notification_settings.get_runtime_inference_settings",
            return_value={"fireworks_chunked_transcription_enabled": False},
        ):
            try:
                bulk_retry_upload_rejected(db=db)
            except HTTPException as e:
                assert e.status_code == 422
                assert "chunked transcription" in e.detail.lower()
                return
        raise AssertionError("Expected HTTPException 422")

    def test_post_re_enqueues_each_eligible_episode(self):
        from app.api.queue import bulk_retry_upload_rejected

        ep1 = _make_episode("failed", id="ep-1", error_class="FIREWORKS_UPLOAD_REJECTED")
        ep1.duration_secs = 100
        ep2 = _make_episode("failed", id="ep-2", error_class="FIREWORKS_UPLOAD_REJECTED")
        ep2.duration_secs = 200
        db = self._make_db_with_episodes([ep1, ep2])

        with (
            patch(
                "app.services.notification_settings.get_runtime_inference_settings",
                return_value={"fireworks_chunked_transcription_enabled": True},
            ),
            patch("app.api.queue.enqueue_episode_ingest") as mock_enqueue,
        ):
            result = bulk_retry_upload_rejected(db=db)

        assert result["queued"] == 2
        assert result["episode_ids"] == ["ep-1", "ep-2"]
        assert mock_enqueue.call_count == 2
        assert ep1.status == "pending"
        assert ep1.error_class is None
        assert ep1.retry_count == 0
        assert ep2.status == "pending"
        db.commit.assert_called_once()


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
