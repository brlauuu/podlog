"""Tests for the Telegram notification handler."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent, send_telegram


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="abc",
        episode_title="Test Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=3,
        queue_estimated_secs=900.0,
    )


@patch("app.services.notifications.httpx")
def test_send_telegram_done_event(mock_httpx):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_httpx.post.return_value = mock_response

    send_telegram(_make_done_event(), bot_token="tok123", chat_id="456")

    mock_httpx.post.assert_called_once()
    call_args = mock_httpx.post.call_args
    assert "tok123" in call_args[0][0]
    assert call_args[1]["json"]["chat_id"] == "456"
    assert "Test Ep" in call_args[1]["json"]["text"]


@patch("app.services.notifications.httpx")
def test_send_telegram_failed_event(mock_httpx):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_httpx.post.return_value = mock_response

    event = EpisodeFailedEvent(
        episode_id="abc",
        episode_title="Bad Ep",
        podcast_title="Pod",
        error_class="OOM",
        error_message="boom",
        retry_count=3,
        retry_max=3,
        queue_remaining=0,
        queue_estimated_secs=None,
    )

    send_telegram(event, bot_token="tok", chat_id="99")

    payload = mock_httpx.post.call_args[1]["json"]
    assert "OOM" in payload["text"]
    assert payload["parse_mode"] == "Markdown"
