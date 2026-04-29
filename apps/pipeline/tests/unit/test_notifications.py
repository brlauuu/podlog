"""Tests for notification event types and queue estimation."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    compute_avg_processing_stats,
    estimate_queue_status,
)
from app.services.notification_runtime import (
    _compute_episode_processing_factor,
    compute_avg_processing_factor,
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


def test_episode_done_event_has_avg_fields():
    """EpisodeDoneEvent should accept avg processing stat fields."""
    event = EpisodeDoneEvent(
        episode_id="ep1",
        episode_title="Test",
        podcast_title="Pod",
        avg_transcribe_secs=120.0,
        avg_diarize_secs=60.0,
        avg_total_secs=200.0,
    )
    assert event.avg_transcribe_secs == 120.0
    assert event.avg_diarize_secs == 60.0
    assert event.avg_total_secs == 200.0


def test_episode_done_event_avg_fields_default_none():
    """Avg fields should default to None for backward compat."""
    event = EpisodeDoneEvent(episode_id="ep1")
    assert event.avg_transcribe_secs is None
    assert event.avg_diarize_secs is None
    assert event.avg_total_secs is None


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


def test_episode_failed_event_has_avg_fields():
    """EpisodeFailedEvent should accept avg processing stat fields."""
    event = EpisodeFailedEvent(
        episode_id="ep1",
        avg_transcribe_secs=100.0,
        avg_diarize_secs=50.0,
        avg_total_secs=180.0,
    )
    assert event.avg_transcribe_secs == 100.0
    assert event.avg_diarize_secs == 50.0
    assert event.avg_total_secs == 180.0


def test_estimate_queue_status_with_history():
    """With recent episodes, estimate uses duration-weighted rate."""
    db = MagicMock()

    # Mock recent completed episodes: 2 episodes, each 1800s audio, each took 900s to process
    # (600s transcribe + 300s diarize = 900s actual processing per episode)
    # Processing rate = 1800s total processing / 3600s total audio = 0.5 per audio sec
    recent_done = MagicMock()
    recent_done.all.return_value = [
        MagicMock(duration_secs=1800, transcribe_duration_secs=600.0, diarize_duration_secs=300.0),
        MagicMock(duration_secs=1800, transcribe_duration_secs=600.0, diarize_duration_secs=300.0),
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

    remaining, estimated, factor = estimate_queue_status(db)
    assert remaining == 3
    # rate = 1800 processing / 3600 audio = 0.5, queued audio = 3600, estimate = 3600 * 0.5 = 1800
    assert estimated == 1800.0
    assert factor == 0.5


def test_compute_avg_processing_stats_with_data():
    """Should compute averages across all done episodes.

    Total per episode = transcribe + diarize (not wall clock).
    """
    db = MagicMock()

    ep1 = MagicMock(
        transcribe_duration_secs=100.0,
        diarize_duration_secs=50.0,
    )
    ep2 = MagicMock(
        transcribe_duration_secs=200.0,
        diarize_duration_secs=100.0,
    )

    query_mock = MagicMock()
    query_mock.filter.return_value = query_mock
    query_mock.all.return_value = [ep1, ep2]
    db.query.return_value = query_mock

    avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
    assert avg_t == 150.0   # (100 + 200) / 2
    assert avg_d == 75.0    # (50 + 100) / 2
    assert avg_total == 225.0  # ((100+50) + (200+100)) / 2


def test_compute_avg_processing_stats_no_data():
    """Should return (None, None, None) when no done episodes exist."""
    db = MagicMock()
    query_mock = MagicMock()
    query_mock.filter.return_value = query_mock
    query_mock.all.return_value = []
    db.query.return_value = query_mock

    avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
    assert avg_t is None
    assert avg_d is None
    assert avg_total is None


def test_compute_avg_processing_stats_partial_data():
    """Should handle episodes with missing transcribe/diarize durations."""
    db = MagicMock()

    ep1 = MagicMock(
        transcribe_duration_secs=100.0,
        diarize_duration_secs=None,  # diarization failed
    )

    query_mock = MagicMock()
    query_mock.filter.return_value = query_mock
    query_mock.all.return_value = [ep1]
    db.query.return_value = query_mock

    avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
    assert avg_t == 100.0
    assert avg_d is None  # no diarize data at all
    assert avg_total == 100.0  # transcribe only (diarize treated as 0)


def test_compute_avg_processing_stats_filters_by_provider():
    """When provider is passed, only matching episodes contribute to the avg."""
    db = MagicMock()

    query_mock = MagicMock()
    query_mock.filter.return_value = query_mock

    # Simulate: one local ep (100/50), one remote ep (10/5). Asking for local → 100/50 only.
    query_mock.all.return_value = [MagicMock(transcribe_duration_secs=100.0, diarize_duration_secs=50.0)]
    db.query.return_value = query_mock

    avg_t, avg_d, avg_total = compute_avg_processing_stats(db, provider="local")
    assert avg_t == 100.0
    assert avg_d == 50.0
    assert avg_total == 150.0

    # The filter should have been called with an extra clause when provider is set.
    # (we just verify it was called at least twice — once for status, once for provider)
    assert query_mock.filter.call_count >= 2


def test_compute_avg_processing_factor_returns_ratio():
    """processing_secs / audio_secs is averaged across done episodes."""
    db = MagicMock()

    ep1 = MagicMock(
        transcribe_duration_secs=600.0, diarize_duration_secs=300.0, duration_secs=1800
    )  # 900 processing / 1800 audio = 0.5
    ep2 = MagicMock(
        transcribe_duration_secs=300.0, diarize_duration_secs=150.0, duration_secs=1800
    )  # 450 / 1800 = 0.25

    q = MagicMock()
    q.filter.return_value = q
    q.all.return_value = [ep1, ep2]
    db.query.return_value = q

    factor = compute_avg_processing_factor(db)
    # duration-weighted: (900 + 450) / (1800 + 1800) = 1350 / 3600 = 0.375
    assert factor == 0.375


def test_compute_avg_processing_factor_no_data():
    db = MagicMock()
    q = MagicMock()
    q.filter.return_value = q
    q.all.return_value = []
    db.query.return_value = q
    assert compute_avg_processing_factor(db) is None


def test_episode_processing_factor_helper():
    """Per-episode factor is processing / duration, or None if missing."""
    assert _compute_episode_processing_factor(900.0, 1800) == 0.5
    assert _compute_episode_processing_factor(None, 1800) is None
    assert _compute_episode_processing_factor(900.0, None) is None
    assert _compute_episode_processing_factor(900.0, 0) is None


def _make_chain(*, recent_episodes_per_call: list, queued_count: int, queued_audio_durations: list[int]):
    """Build a self-chaining query mock.

    `db.query(...).filter(...).filter(...)...` always returns the same chain object so
    arbitrary `.filter()` chains resolve. Each call to `.limit().all()` consumes the
    next list from `recent_episodes_per_call`. `.count()` and the bare `.all()` (no
    `.limit()` in between) return queued data.
    """
    recent_iter = iter(recent_episodes_per_call)
    queued_episodes = [MagicMock(duration_secs=d) for d in queued_audio_durations]

    chain = MagicMock()
    chain.filter.return_value = chain
    chain.order_by.return_value = chain
    chain.count.return_value = queued_count
    chain.all.return_value = queued_episodes  # used by queued_episodes path

    limit_chain = MagicMock()
    limit_chain.all = MagicMock(side_effect=lambda: next(recent_iter, []))
    chain.limit.return_value = limit_chain

    db = MagicMock()
    db.query.return_value = chain
    return db


def test_estimate_queue_status_filters_recent_by_provider():
    """When provider is set, only matching episodes seed the rate."""
    fast_remote = MagicMock(duration_secs=1800, transcribe_duration_secs=20.0, diarize_duration_secs=10.0)
    db = _make_chain(
        recent_episodes_per_call=[[fast_remote]],
        queued_count=1,
        queued_audio_durations=[1800],
    )

    remaining, estimated, factor = estimate_queue_status(db, provider="fireworks")
    assert remaining == 1
    # 30s processing / 1800s audio = 1/60 ⇒ 1800 * 1/60 = 30s ETA
    assert estimated == 30.0
    assert factor is not None and abs(factor - (1 / 60)) < 1e-9


def test_estimate_queue_status_provider_falls_back_when_no_history():
    """If the active provider has no recent episodes, fall back to all-providers."""
    slow_local = MagicMock(duration_secs=1800, transcribe_duration_secs=600.0, diarize_duration_secs=300.0)
    db = _make_chain(
        recent_episodes_per_call=[[], [slow_local]],  # provider-narrowed empty, fallback hit
        queued_count=1,
        queued_audio_durations=[1800],
    )

    remaining, estimated, _ = estimate_queue_status(db, provider="fireworks")
    assert remaining == 1
    # 900 / 1800 = 0.5; queued audio = 1800 ⇒ ETA 900s.
    assert estimated == 900.0


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

    remaining, estimated, factor = estimate_queue_status(db)
    assert remaining == 2
    assert estimated is None
    assert factor is None
