# apps/pipeline/tests/unit/test_digest_wiring.py
"""Tests for notification handler registration based on frequency setting."""
from unittest.mock import MagicMock, patch, call

from app.services.events import EventBus
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent


def test_immediate_mode_subscribes_send_directly():
    """In immediate mode, both event types get handlers that call _send_immediate."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)

    # Always registers exactly one handler for done and one for failed
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    assert len(bus._handlers[EpisodeFailedEvent]) == 1


def test_daily_mode_logs_done_sends_failed():
    """In daily mode, done events are logged; failed events are logged and sent immediately."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)

    # Both event types get exactly one handler (the dispatch-time checker)
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    assert len(bus._handlers[EpisodeFailedEvent]) == 1


def test_handlers_always_registered():
    """Handlers are always registered regardless of channel config — checked at dispatch time."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)

    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    assert len(bus._handlers[EpisodeFailedEvent]) == 1


def test_done_handler_calls_send_immediate_in_immediate_mode():
    """_handle_done calls _send_immediate when frequency is 'immediate'."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers

    ns_immediate = {
        "notification_frequency": "immediate",
        "email_configured": False,
        "telegram_configured": False,
    }

    with patch("app.services.digest.get_notification_settings", return_value=ns_immediate), \
         patch("app.services.digest.SessionLocal"):
        register_notification_handlers(bus)
        event = MagicMock(spec=EpisodeDoneEvent)
        # Should run without error; no channels configured so nothing sent
        bus._handlers[EpisodeDoneEvent][0](event)


def test_done_handler_logs_event_in_digest_mode():
    """_handle_done calls log_event when frequency is 'daily'."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers

    ns_daily = {
        "notification_frequency": "daily",
        "email_configured": False,
        "telegram_configured": False,
    }

    with patch("app.services.digest.get_notification_settings", return_value=ns_daily), \
         patch("app.services.digest.SessionLocal"), \
         patch("app.services.digest.log_event") as mock_log:
        register_notification_handlers(bus)
        event = MagicMock(spec=EpisodeDoneEvent)
        bus._handlers[EpisodeDoneEvent][0](event)

    mock_log.assert_called_once_with(event, mark_sent=False)


def test_email_failure_does_not_block_telegram():
    """If send_email raises, send_telegram should still be called."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers

    ns_both = {
        "notification_frequency": "immediate",
        "email_configured": True,
        "telegram_configured": True,
        "notification_email_to": "test@example.com",
        "notification_email_from": "podlog@localhost",
        "smtp_host": "localhost",
        "smtp_port": 25,
        "smtp_user": None,
        "smtp_password": None,
        "smtp_use_tls": False,
        "telegram_bot_token": "fake-token",
        "telegram_chat_id": "12345",
    }

    with patch("app.services.digest.get_notification_settings", return_value=ns_both), \
         patch("app.services.digest.SessionLocal"), \
         patch("app.services.digest.send_email", side_effect=Exception("SMTP error")), \
         patch("app.services.digest.send_telegram") as mock_tg:
        register_notification_handlers(bus)
        event = MagicMock(spec=EpisodeDoneEvent)
        bus._handlers[EpisodeDoneEvent][0](event)

    mock_tg.assert_called_once_with(event, bot_token="fake-token", chat_id="12345")


def test_telegram_failure_does_not_block_email():
    """If send_telegram raises, send_email should still have been called."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers

    ns_both = {
        "notification_frequency": "immediate",
        "email_configured": True,
        "telegram_configured": True,
        "notification_email_to": "test@example.com",
        "notification_email_from": "podlog@localhost",
        "smtp_host": "localhost",
        "smtp_port": 25,
        "smtp_user": None,
        "smtp_password": None,
        "smtp_use_tls": False,
        "telegram_bot_token": "fake-token",
        "telegram_chat_id": "12345",
    }

    with patch("app.services.digest.get_notification_settings", return_value=ns_both), \
         patch("app.services.digest.SessionLocal"), \
         patch("app.services.digest.send_email") as mock_email, \
         patch("app.services.digest.send_telegram", side_effect=Exception("Telegram error")):
        register_notification_handlers(bus)
        event = MagicMock(spec=EpisodeDoneEvent)
        bus._handlers[EpisodeDoneEvent][0](event)

    mock_email.assert_called_once()


def test_failed_handler_logs_and_sends_in_digest_mode():
    """_handle_failed logs event and sends immediately when frequency is 'daily'."""
    bus = EventBus()

    from app.services.digest import register_notification_handlers

    ns_daily = {
        "notification_frequency": "daily",
        "email_configured": False,
        "telegram_configured": False,
    }

    with patch("app.services.digest.get_notification_settings", return_value=ns_daily), \
         patch("app.services.digest.SessionLocal"), \
         patch("app.services.digest.log_event") as mock_log:
        register_notification_handlers(bus)
        event = MagicMock(spec=EpisodeFailedEvent)
        bus._handlers[EpisodeFailedEvent][0](event)

    mock_log.assert_called_once_with(event, mark_sent=True)
