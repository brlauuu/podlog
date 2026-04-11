"""Unit tests for app.services.notification_events dataclasses."""

from app.services.events import Event
from app.services.notification_events import EpisodeDoneEvent, EpisodeFailedEvent


def test_episode_done_event_defaults_and_base_type():
    event = EpisodeDoneEvent()
    assert isinstance(event, Event)
    assert event.episode_id == ""
    assert event.queue_remaining == 0
    assert event.processing_factor is None


def test_episode_failed_event_fields():
    event = EpisodeFailedEvent(
        episode_id="ep-1",
        error_class="TRANSIENT_NETWORK",
        error_message="timeout",
        retry_count=1,
        retry_max=3,
    )
    assert isinstance(event, Event)
    assert event.episode_id == "ep-1"
    assert event.error_class == "TRANSIENT_NETWORK"
    assert event.error_message == "timeout"
    assert event.retry_count == 1
    assert event.retry_max == 3
