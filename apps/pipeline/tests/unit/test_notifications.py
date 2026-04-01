"""Tests for notification event types and queue estimation."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    estimate_queue_status,
)


def test_episode_done_event_fields():
    event = EpisodeDoneEvent(
        episode_id="ep1",
        episode_title="Test Episode",
        podcast_title="Test Podcast",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=1000.0,
    )
    assert event.episode_title == "Test Episode"
    assert event.queue_remaining == 5


def test_episode_failed_event_fields():
    event = EpisodeFailedEvent(
        episode_id="ep1",
        episode_title="Test Episode",
        podcast_title="Test Podcast",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        duration_secs=3600,
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=500.0,
    )
    assert event.error_class == "OOM"
    assert event.retry_count == 3


def test_estimate_queue_status_with_history():
    """With recent episodes, estimate uses duration-weighted rate."""
    db = MagicMock()

    # Mock recent completed episodes: 2 episodes, each 1800s audio, each took 900s to process
    # Processing rate = 1800s total wall / 3600s total audio = 0.5 wall-per-audio-sec
    recent_done = MagicMock()
    recent_done.all.return_value = [
        MagicMock(duration_secs=1800, created_at=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                  processed_at=datetime(2026, 1, 1, 0, 15, tzinfo=timezone.utc)),  # 900s
        MagicMock(duration_secs=1800, created_at=datetime(2026, 1, 1, 1, 0, tzinfo=timezone.utc),
                  processed_at=datetime(2026, 1, 1, 1, 15, tzinfo=timezone.utc)),  # 900s
    ]

    # Mock queued episodes: 3 episodes, each 1200s audio = 3600s total audio
    queued = MagicMock()
    queued.count.return_value = 3
    queued_with_duration = MagicMock()
    queued_with_duration.all.return_value = [
        MagicMock(duration_secs=1200),
        MagicMock(duration_secs=1200),
        MagicMock(duration_secs=1200),
    ]

    def mock_query(model):
        return MagicMock(filter=MagicMock(return_value=MagicMock(
            order_by=MagicMock(return_value=MagicMock(limit=MagicMock(return_value=recent_done))),
            count=queued.count,
            all=queued_with_duration.all,
        )))

    db.query = mock_query

    remaining, estimated = estimate_queue_status(db)
    assert remaining == 3
    # rate = 1800 / 3600 = 0.5, queued audio = 3600, estimate = 3600 * 0.5 = 1800
    assert estimated == 1800.0


def test_estimate_queue_status_no_history():
    """Without recent completed episodes, estimated_secs is None."""
    db = MagicMock()

    recent_done = MagicMock()
    recent_done.all.return_value = []

    queued = MagicMock()
    queued.count.return_value = 2

    def mock_query(model):
        return MagicMock(filter=MagicMock(return_value=MagicMock(
            order_by=MagicMock(return_value=MagicMock(limit=MagicMock(return_value=recent_done))),
            count=queued.count,
        )))

    db.query = mock_query

    remaining, estimated = estimate_queue_status(db)
    assert remaining == 2
    assert estimated is None
