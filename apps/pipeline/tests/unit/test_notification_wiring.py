"""Tests for notification event emission from pipeline tasks."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.events import EventBus
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent


@patch("app.tasks.archive.bus")
@patch("app.tasks.archive.estimate_queue_status", return_value=(3, 900.0))
@patch("app.tasks.archive._write_transcript", return_value="/data/transcripts/ep1.txt")
@patch("app.tasks.archive.update_episode")
@patch("app.tasks.archive.SessionLocal")
def test_archive_emits_done_event(mock_session_cls, mock_update, mock_write, mock_estimate, mock_bus):
    """archive_episode emits EpisodeDoneEvent on success."""
    db = MagicMock()
    mock_session_cls.return_value = db

    episode = MagicMock()
    episode.id = "ep1"
    episode.title = "Test"
    episode.audio_local_path = None
    episode.has_diarization = True
    episode.duration_secs = 3600
    episode.transcribe_duration_secs = 120.0
    episode.diarize_duration_secs = 60.0
    episode.created_at = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    episode.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    episode.feed = MagicMock()
    episode.feed.title = "My Podcast"

    verified = MagicMock()
    verified.status = "done"
    verified.processed_at = datetime(2026, 1, 1, 0, 3, 20, tzinfo=timezone.utc)

    db.query.return_value.filter.return_value.first.side_effect = [episode, verified]
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
        MagicMock(start_time=0, end_time=10, text="hello", speaker_label="SPEAKER_00")
    ]
    db.query.return_value.filter.return_value.all.return_value = []

    from app.tasks.archive import archive_episode
    archive_episode("ep1")

    mock_bus.emit.assert_called_once()
    event = mock_bus.emit.call_args[0][0]
    assert isinstance(event, EpisodeDoneEvent)
    assert event.episode_title == "Test"
    assert event.podcast_title == "My Podcast"
    assert event.queue_remaining == 3


@patch("app.tasks.archive.bus")
@patch("app.tasks.archive.estimate_queue_status", return_value=(0, None))
@patch("app.tasks.archive._write_transcript", return_value="/data/transcripts/ep1.txt")
@patch("app.tasks.archive.update_episode")
@patch("app.tasks.archive.SessionLocal")
def test_archive_done_event_total_excludes_pre_transcription_wait(
    mock_session_cls, mock_update, mock_write, mock_estimate, mock_bus
):
    """Notification total should reflect active speech-processing time, not queue age."""
    db = MagicMock()
    mock_session_cls.return_value = db

    episode = MagicMock()
    episode.id = "ep1"
    episode.title = "Test"
    episode.audio_local_path = None
    episode.has_diarization = True
    episode.duration_secs = 3600
    episode.transcribe_duration_secs = 120.0
    episode.diarize_duration_secs = 60.0
    episode.created_at = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    episode.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    episode.feed = MagicMock()
    episode.feed.title = "My Podcast"

    verified = MagicMock()
    verified.status = "done"
    verified.processed_at = datetime(2026, 1, 1, 5, 0, tzinfo=timezone.utc)

    db.query.return_value.filter.return_value.first.side_effect = [episode, verified]
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
        MagicMock(start_time=0, end_time=10, text="hello", speaker_label="SPEAKER_00")
    ]
    db.query.return_value.filter.return_value.all.return_value = []

    from app.tasks.archive import archive_episode
    archive_episode("ep1")

    event = mock_bus.emit.call_args[0][0]
    assert event.total_duration_secs == 180.0


@patch("app.tasks.helpers.bus")
@patch("app.tasks.helpers.estimate_queue_status", return_value=(2, None))
def test_worker_emits_failed_event_on_terminal_failure(mock_estimate, mock_bus):
    """mark_failed emits EpisodeFailedEvent when episode reaches terminal failure."""
    db = MagicMock()
    episode = MagicMock()
    episode.id = "ep1"
    episode.title = "Bad Ep"
    episode.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    episode.duration_secs = 1800
    episode.retry_count = 3
    episode.retry_max = 3
    episode.feed = MagicMock()
    episode.feed.title = "Pod"

    db.query.return_value.filter.return_value.first.return_value = episode

    from app.tasks.helpers import mark_failed
    mark_failed(db, "ep1", "OOM", "Out of memory")

    mock_bus.emit.assert_called_once()
    event = mock_bus.emit.call_args[0][0]
    assert isinstance(event, EpisodeFailedEvent)
    assert event.error_class == "OOM"


@patch("app.tasks.helpers.bus")
@patch("app.tasks.helpers.estimate_queue_status", return_value=(2, None))
def test_no_failed_event_on_retryable_failure(mock_estimate, mock_bus):
    """mark_failed does NOT emit when retries remain."""
    db = MagicMock()
    episode = MagicMock()
    episode.id = "ep1"
    episode.retry_count = 1
    episode.retry_max = 3

    db.query.return_value.filter.return_value.first.return_value = episode

    from app.tasks.helpers import mark_failed
    mark_failed(db, "ep1", "TRANSIENT_NETWORK", "timeout")

    mock_bus.emit.assert_not_called()
