"""Notifications API — settings CRUD and test send."""
import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

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


@router.get("/notifications/settings")
def get_settings(db: Session = Depends(get_db)):
    s = get_notification_settings(db)
    return mask_sensitive(s)


@router.put("/notifications/settings")
def put_settings(body: dict, db: Session = Depends(get_db)):
    try:
        result = save_notification_settings(db, body)
        return mask_sensitive(result)
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})


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

    if body.channel == "email":
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
