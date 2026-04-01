"""Tests for notification config helpers."""
import os
from unittest.mock import patch


def test_email_notifications_disabled_by_default():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t")
    assert s.email_notifications_enabled is False


def test_email_notifications_enabled_when_to_set():
    from app.config import Settings
    s = Settings(
        database_url="postgresql://x",
        hf_token="t",
        notification_email_to="user@example.com",
    )
    assert s.email_notifications_enabled is True


def test_telegram_disabled_when_only_token_set():
    from app.config import Settings
    s = Settings(
        database_url="postgresql://x",
        hf_token="t",
        telegram_bot_token="abc",
    )
    assert s.telegram_notifications_enabled is False


def test_telegram_enabled_when_both_set():
    from app.config import Settings
    s = Settings(
        database_url="postgresql://x",
        hf_token="t",
        telegram_bot_token="abc",
        telegram_chat_id="123",
    )
    assert s.telegram_notifications_enabled is True
