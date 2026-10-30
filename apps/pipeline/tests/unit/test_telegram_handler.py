"""Tests for the Telegram notification handler."""
import logging
from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest

from app.services.notifications import (
    TELEGRAM_MAX_CHARS,
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    TelegramSendError,
    post_telegram_message,
    send_telegram,
)

TOKEN = "123456:SECRET-token-value"


def _resp(status: int, body: dict) -> httpx.Response:
    """A real httpx.Response, so error paths behave as they do in production."""
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    return httpx.Response(status, json=body, request=httpx.Request("POST", url))


OK = {"ok": True, "result": {"message_id": 1}}


@pytest.fixture
def post():
    with patch("app.services.notifications.httpx.post") as mock_post:
        mock_post.return_value = _resp(200, OK)
        yield mock_post


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


def test_send_telegram_done_event(post):
    send_telegram(_make_done_event(), bot_token="tok123", chat_id="456")

    post.assert_called_once()
    call_args = post.call_args
    assert "tok123" in call_args[0][0]
    assert call_args[1]["json"]["chat_id"] == "456"
    assert "Test Ep" in call_args[1]["json"]["text"]


def _failed_event(error_message="boom") -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="abc",
        episode_title="Bad Ep",
        podcast_title="Pod",
        error_class="OOM",
        error_message=error_message,
        retry_count=3,
        retry_max=3,
        queue_remaining=0,
        queue_estimated_secs=None,
    )


def test_send_telegram_failed_event(post):
    send_telegram(_failed_event(), bot_token="tok", chat_id="99")

    payload = post.call_args[1]["json"]
    assert "OOM" in payload["text"]
    assert payload["parse_mode"] == "Markdown"


class TestNoTokenInErrors:
    """#1093 follow-up: the failure path wrote the bot token into the worker log."""

    def _formatted(self, exc_info) -> str:
        import traceback
        return "".join(traceback.format_exception(exc_info.value))

    def test_http_error_carries_no_token(self, post):
        post.return_value = _resp(401, {"ok": False, "description": "Unauthorized"})
        with pytest.raises(TelegramSendError) as exc_info:
            post_telegram_message(TOKEN, "1", "hi")
        assert exc_info.value.status == 401
        assert "Unauthorized" in str(exc_info.value)
        assert TOKEN not in self._formatted(exc_info)

    def test_logged_failure_carries_no_token(self, post, caplog):
        """What register_notification_handlers does with it: logger.exception."""
        post.return_value = _resp(400, {"ok": False, "description": "Bad Request: chat not found"})
        log = logging.getLogger("test")
        with caplog.at_level(logging.ERROR):
            try:
                send_telegram(_failed_event(), bot_token=TOKEN, chat_id="1")
            except Exception:
                log.exception('"action": "telegram_send_failed"')
        assert "chat not found" in caplog.text
        assert TOKEN not in caplog.text

    def test_network_error_carries_no_token(self, post):
        url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
        post.side_effect = httpx.ConnectError(f"cannot reach {url}")
        with pytest.raises(TelegramSendError) as exc_info:
            post_telegram_message(TOKEN, "1", "hi")
        assert TOKEN not in self._formatted(exc_info)

    def test_description_echoing_the_token_is_redacted(self, post):
        post.return_value = _resp(404, {"ok": False, "description": f"Not Found: bot{TOKEN}"})
        with pytest.raises(TelegramSendError) as exc_info:
            post_telegram_message(TOKEN, "1", "hi")
        assert TOKEN not in str(exc_info.value)


class TestDelivery:
    def test_text_is_clipped_to_the_telegram_limit(self, post):
        post_telegram_message(TOKEN, "1", "x" * 10_000)
        assert len(post.call_args[1]["json"]["text"]) == TELEGRAM_MAX_CHARS

    def test_long_error_message_is_clipped_in_the_alert(self, post):
        send_telegram(_failed_event("E" * 150_000), bot_token=TOKEN, chat_id="1")
        text = post.call_args[1]["json"]["text"]
        assert len(text) < TELEGRAM_MAX_CHARS
        assert "E" * 50 in text

    def test_unparseable_markdown_is_resent_as_plain_text(self, post):
        post.side_effect = [
            _resp(400, {"ok": False, "description": "Bad Request: can't parse entities"}),
            _resp(200, OK),
        ]
        post_telegram_message(TOKEN, "1", "speaker_label__0 *x")
        first, second = (c[1]["json"] for c in post.call_args_list)
        assert first["parse_mode"] == "Markdown"
        assert "parse_mode" not in second
        assert second["text"] == "speaker_label__0 *x"

    def test_other_400_is_not_retried(self, post):
        post.return_value = _resp(400, {"ok": False, "description": "Bad Request: chat not found"})
        with pytest.raises(TelegramSendError):
            post_telegram_message(TOKEN, "1", "hi")
        assert post.call_count == 1
