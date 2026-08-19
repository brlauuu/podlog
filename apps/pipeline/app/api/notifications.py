"""Notifications API — settings CRUD and test send."""
import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Literal

import httpx
from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.services.notification_settings import (
    get_notification_settings,
    mask_sensitive,
    save_notification_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class TestRequest(BaseModel):
    channel: Literal["telegram", "email"]


class PyannoteTestRequest(BaseModel):
    """#933. `api_key` is optional: the settings UI masks a stored key on read
    (abc***xyz), so an untouched field submits a masked value, not the real
    one. Empty or masked means "test what is saved"."""

    api_key: str | None = None


@router.get("/notifications/settings")
def get_settings(db: Session = Depends(get_db)):
    s = get_notification_settings(db)
    return mask_sensitive(s)


@router.put("/notifications/settings")
def put_settings(body: dict = Body(...), db: Session = Depends(get_db)):
    try:
        result = save_notification_settings(db, body)
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})

    response = mask_sensitive(result)

    # Validate Fireworks API key if it was updated with a non-empty value
    if body.get("fireworks_api_key") and body["fireworks_api_key"].strip():
        from app.services.hardware import validate_fireworks_key

        if not validate_fireworks_key(body["fireworks_api_key"]):
            response["fireworks_key_warning"] = (
                "Fireworks API key could not be validated -- check that it's correct."
            )

    return response


@router.post("/notifications/test")
def post_test(body: TestRequest, db: Session = Depends(get_db)):
    s = get_notification_settings(db)

    if body.channel == "telegram":
        if not s.get("telegram_configured"):
            return JSONResponse(
                status_code=400,
                content={"error": "Telegram is not configured. Save a bot token and chat ID first."},
            )
        try:
            send_test_telegram(s["telegram_bot_token"], s["telegram_chat_id"])
            return {"ok": True}
        except Exception as e:
            logger.exception('"action": "test_telegram_failed"')
            return JSONResponse(status_code=502, content={"error": str(e)})

    elif body.channel == "email":
        if not s.get("email_configured"):
            return JSONResponse(
                status_code=400,
                content={"error": "Email is not configured. Save a recipient address first."},
            )
        try:
            send_test_email(s)
            return {"ok": True}
        except Exception as e:
            logger.exception('"action": "test_email_failed"')
            return JSONResponse(status_code=502, content={"error": str(e)})


@router.post("/pyannote/test")
def post_pyannote_test(body: PyannoteTestRequest, db: Session = Depends(get_db)):
    """Verify a pyannote cloud API key against GET /v1/test (#933).

    Mirrors POST /notifications/test. Without this, an invalid key fails
    silently at save time and only surfaces as a 401 once a diarization job
    runs -- after the episode has already been downloaded and transcribed.

    The base URL is read from settings and never from the request. That is
    deliberate: the request carries a secret, and taking the destination from
    the caller would let it be pointed at an arbitrary host.
    """
    from app.services.pyannote_cloud import verify_api_key

    s = get_notification_settings(db)
    base_url = s.get("pyannote_cloud_base_url") or settings.pyannote_cloud_base_url

    candidate = (body.api_key or "").strip()
    if not candidate or "***" in candidate:
        # Untouched (masked) or omitted -- fall back to the stored key.
        candidate = (s.get("pyannote_api_key") or "").strip()

    if not candidate:
        return JSONResponse(
            status_code=400,
            content={"error": "No pyannote API key to test. Enter a key, or save one first."},
        )

    if verify_api_key(candidate, base_url):
        logger.info('"action": "pyannote_key_test", "result": "valid"')
        return {"ok": True}

    logger.info('"action": "pyannote_key_test", "result": "rejected"')
    return JSONResponse(
        status_code=502,
        content={
            "error": (
                "pyannote.ai rejected this key, or could not be reached. "
                "Check the key at dashboard.pyannote.ai."
            )
        },
    )


def send_test_telegram(bot_token: str, chat_id: str) -> None:
    """Send a test message via Telegram Bot API."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    text = f"*✅ Podlog Test*\n\nThis is a test notification from Podlog.\nSent at {now}"
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = httpx.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
    resp.raise_for_status()


def send_test_email(s: dict) -> None:
    """Send a test email via SMTP."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    html = (
        '<html><body style="font-family: system-ui, sans-serif; padding: 16px;">'
        "<h2>Podlog Test</h2>"
        f"<p>This is a test notification from Podlog.</p>"
        f"<p>Sent at {now}</p>"
        "</body></html>"
    )
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Podlog — Test Notification"
    msg["From"] = s.get("notification_email_from", "podlog@localhost")
    msg["To"] = s["notification_email_to"]
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(s.get("smtp_host", "host.docker.internal"), s.get("smtp_port", 25)) as server:
        if s.get("smtp_use_tls"):
            server.starttls()
        if s.get("smtp_user") and s.get("smtp_password"):
            server.login(s["smtp_user"], s["smtp_password"])
        server.send_message(msg)
