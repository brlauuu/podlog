"""Tests for the notifications API router."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_db():
    """Override the get_db dependency with a mock session."""
    mock_session = MagicMock()
    from app.database import get_db

    def override():
        yield mock_session

    app.dependency_overrides[get_db] = override
    yield mock_session
    app.dependency_overrides.clear()


class TestGetSettings:
    @patch("app.api.notifications.get_notification_settings")
    @patch("app.api.notifications.mask_sensitive")
    def test_returns_masked_settings(self, mock_mask, mock_get, mock_db):
        mock_get.return_value = {
            "telegram_bot_token": "secret",
            "telegram_chat_id": "123",
            "telegram_configured": True,
            "email_configured": False,
            "notification_frequency": "immediate",
        }
        mock_mask.return_value = {
            "telegram_bot_token": "sec***ret",
            "telegram_chat_id": "123",
            "telegram_configured": True,
            "email_configured": False,
            "notification_frequency": "immediate",
        }

        resp = client.get("/api/notifications/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["telegram_bot_token"] == "sec***ret"
        assert data["telegram_configured"] is True


class TestPutSettings:
    @patch("app.api.notifications.save_notification_settings")
    @patch("app.api.notifications.mask_sensitive")
    def test_saves_and_returns_masked(self, mock_mask, mock_save, mock_db):
        mock_save.return_value = {"telegram_bot_token": "new_tok", "telegram_configured": True}
        mock_mask.return_value = {"telegram_bot_token": "new***tok", "telegram_configured": True}

        resp = client.put("/api/notifications/settings", json={"telegram_bot_token": "new_tok"})
        assert resp.status_code == 200
        mock_save.assert_called_once()
        assert resp.json()["telegram_bot_token"] == "new***tok"

    @patch("app.api.notifications.save_notification_settings")
    def test_returns_422_on_invalid_input(self, mock_save, mock_db):
        mock_save.side_effect = ValueError("notification_frequency must be one of")

        resp = client.put("/api/notifications/settings", json={"notification_frequency": "hourly"})
        assert resp.status_code == 422
        assert "notification_frequency" in resp.json()["error"]


class TestPostTest:
    @patch("app.api.notifications.get_notification_settings")
    @patch("app.api.notifications.send_test_telegram")
    def test_telegram_test_success(self, mock_send, mock_get, mock_db):
        mock_get.return_value = {
            "telegram_bot_token": "tok",
            "telegram_chat_id": "123",
            "telegram_configured": True,
            "email_configured": False,
        }

        resp = client.post("/api/notifications/test", json={"channel": "telegram"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @patch("app.api.notifications.get_notification_settings")
    def test_telegram_test_not_configured(self, mock_get, mock_db):
        mock_get.return_value = {
            "telegram_configured": False,
            "email_configured": False,
        }

        resp = client.post("/api/notifications/test", json={"channel": "telegram"})
        assert resp.status_code == 400
        assert "not configured" in resp.json()["error"].lower()

    @patch("app.api.notifications.get_notification_settings")
    @patch("app.api.notifications.send_test_email")
    def test_email_test_success(self, mock_send, mock_get, mock_db):
        mock_get.return_value = {
            "notification_email_to": "user@example.com",
            "notification_email_from": "podlog@localhost",
            "smtp_host": "localhost",
            "smtp_port": 25,
            "smtp_user": None,
            "smtp_password": None,
            "smtp_use_tls": False,
            "telegram_configured": False,
            "email_configured": True,
        }

        resp = client.post("/api/notifications/test", json={"channel": "email"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_invalid_channel(self, mock_db):
        resp = client.post("/api/notifications/test", json={"channel": "sms"})
        assert resp.status_code == 422

    @patch("app.api.notifications.get_notification_settings")
    @patch("app.api.notifications.send_test_telegram", side_effect=RuntimeError("telegram boom"))
    def test_telegram_test_failure_returns_502(self, mock_send, mock_get, mock_db):
        mock_get.return_value = {
            "telegram_bot_token": "tok",
            "telegram_chat_id": "123",
            "telegram_configured": True,
            "email_configured": False,
        }

        resp = client.post("/api/notifications/test", json={"channel": "telegram"})
        assert resp.status_code == 502
        assert "telegram boom" in resp.json()["error"]

    @patch("app.api.notifications.get_notification_settings")
    def test_email_test_not_configured(self, mock_get, mock_db):
        mock_get.return_value = {
            "telegram_configured": False,
            "email_configured": False,
        }

        resp = client.post("/api/notifications/test", json={"channel": "email"})
        assert resp.status_code == 400
        assert "not configured" in resp.json()["error"].lower()

    @patch("app.api.notifications.get_notification_settings")
    @patch("app.api.notifications.send_test_email", side_effect=RuntimeError("smtp down"))
    def test_email_test_failure_returns_502(self, mock_send, mock_get, mock_db):
        mock_get.return_value = {
            "notification_email_to": "user@example.com",
            "notification_email_from": "podlog@localhost",
            "smtp_host": "localhost",
            "smtp_port": 25,
            "smtp_user": None,
            "smtp_password": None,
            "smtp_use_tls": False,
            "telegram_configured": False,
            "email_configured": True,
        }

        resp = client.post("/api/notifications/test", json={"channel": "email"})
        assert resp.status_code == 502
        assert "smtp down" in resp.json()["error"]


@patch("app.api.notifications.httpx.post")
def test_send_test_telegram_calls_api(mock_post):
    from app.api.notifications import send_test_telegram

    mock_resp = MagicMock()
    mock_post.return_value = mock_resp

    send_test_telegram("token", "chat-id")

    mock_post.assert_called_once()
    mock_resp.raise_for_status.assert_called_once()


@patch("app.api.notifications.smtplib.SMTP")
def test_send_test_email_tls_and_login(mock_smtp):
    from app.api.notifications import send_test_email

    smtp_inst = MagicMock()
    mock_smtp.return_value.__enter__.return_value = smtp_inst

    send_test_email(
        {
            "notification_email_to": "user@example.com",
            "notification_email_from": "podlog@localhost",
            "smtp_host": "localhost",
            "smtp_port": 2525,
            "smtp_user": "user",
            "smtp_password": "pass",
            "smtp_use_tls": True,
        }
    )

    smtp_inst.starttls.assert_called_once()
    smtp_inst.login.assert_called_once_with("user", "pass")
    smtp_inst.send_message.assert_called_once()
