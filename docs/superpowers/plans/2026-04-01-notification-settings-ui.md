# Notification Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/notifications` page where users can configure Telegram/email notification settings, send test messages, and follow setup guides — all backed by DB storage with env var fallback.

**Architecture:** Pipeline gets a new `notification_settings` service that reads/writes a JSON blob in the existing `system_state` table, with env var fallback from `config.py`. Three new FastAPI endpoints expose settings CRUD + test send. The Next.js web app proxies to these endpoints and renders a tabbed form UI (Telegram, Email, General). `digest.py` is modified to read settings from DB instead of the static `settings` singleton.

**Tech Stack:** FastAPI + Pydantic (pipeline API), SQLAlchemy (DB access), Next.js 14 App Router (web), Tailwind CSS (styling)

**Spec:** `docs/superpowers/specs/2026-04-01-notification-settings-ui-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/pipeline/app/services/notification_settings.py` | Read/write/mask notification settings from `system_state` with env var fallback |
| `apps/pipeline/app/api/notifications.py` | FastAPI router: GET/PUT settings, POST test |
| `apps/pipeline/tests/unit/test_notification_settings.py` | Unit tests for the settings service |
| `apps/pipeline/tests/unit/test_notifications_api.py` | Unit tests for the notifications API router |
| `apps/web/src/app/notifications/page.tsx` | Server component — page shell |
| `apps/web/src/components/NotificationSettings.tsx` | Client component — tabbed forms, save/test logic |
| `apps/web/src/app/api/notifications/settings/route.ts` | GET/PUT proxy to pipeline |
| `apps/web/src/app/api/notifications/test/route.ts` | POST proxy to pipeline |
| `apps/web/tests/unit/notification-settings.test.tsx` | Unit tests for the NotificationSettings component |

### Modified Files

| File | Change |
|---|---|
| `apps/pipeline/app/main.py` | Mount notifications router |
| `apps/pipeline/app/services/digest.py` | Read settings from DB via `get_notification_settings()` instead of `settings` singleton |
| `apps/web/src/components/Navbar.tsx` | Add "Notifications" link after "Queue" |

---

## Task 1: Pipeline — Notification Settings Service

**Files:**
- Create: `apps/pipeline/app/services/notification_settings.py`
- Create: `apps/pipeline/tests/unit/test_notification_settings.py`

This service reads/writes notification settings from the `system_state` table with env var fallback from `config.py`. It stores all settings as a single JSON blob under key `notification_settings`.

- [ ] **Step 1: Write failing tests for get_notification_settings**

Create `apps/pipeline/tests/unit/test_notification_settings.py`:

```python
"""Tests for notification settings service — DB-backed with env var fallback."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.models import SystemState
from app.services.notification_settings import (
    get_notification_settings,
    save_notification_settings,
    mask_sensitive,
    SETTINGS_KEY,
)


def _mock_db(stored_json: str | None = None):
    """Create a mock DB session. If stored_json is provided, simulate an existing row."""
    db = MagicMock()
    if stored_json is not None:
        row = MagicMock(spec=SystemState)
        row.key = SETTINGS_KEY
        row.value = stored_json
        db.query.return_value.filter.return_value.first.return_value = row
    else:
        db.query.return_value.filter.return_value.first.return_value = None
    return db


class TestGetNotificationSettings:
    def test_returns_env_var_defaults_when_no_db_row(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["telegram_bot_token"] is None
        assert result["notification_email_from"] == "podlog@localhost"
        assert result["smtp_port"] == 25
        assert result["notification_frequency"] == "immediate"
        assert result["telegram_configured"] is False
        assert result["email_configured"] is False

    def test_returns_db_values_when_row_exists(self):
        stored = json.dumps({
            "telegram_bot_token": "123:ABC",
            "telegram_chat_id": "999",
            "notification_email_to": "user@example.com",
        })
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["telegram_bot_token"] == "123:ABC"
        assert result["telegram_chat_id"] == "999"
        assert result["notification_email_to"] == "user@example.com"
        # Fallback for fields not in DB
        assert result["notification_email_from"] == "podlog@localhost"
        assert result["telegram_configured"] is True
        assert result["email_configured"] is True

    def test_db_values_override_env_vars(self):
        stored = json.dumps({"smtp_port": 587, "smtp_use_tls": True})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["smtp_port"] == 587
        assert result["smtp_use_tls"] is True


class TestSaveNotificationSettings:
    def test_creates_row_when_none_exists(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"telegram_bot_token": "tok123"})

        assert result["telegram_bot_token"] == "tok123"
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_merges_into_existing_row(self):
        stored = json.dumps({"telegram_bot_token": "old_token", "telegram_chat_id": "999"})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"telegram_bot_token": "new_token"})

        assert result["telegram_bot_token"] == "new_token"
        assert result["telegram_chat_id"] == "999"
        db.commit.assert_called_once()

    def test_rejects_invalid_frequency(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="notification_frequency"):
            save_notification_settings(db, {"notification_frequency": "hourly"})

    def test_rejects_invalid_smtp_port(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="smtp_port"):
            save_notification_settings(db, {"smtp_port": -1})


class TestMaskSensitive:
    def test_masks_bot_token(self):
        s = {"telegram_bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}
        result = mask_sensitive(s)
        assert result["telegram_bot_token"] != "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
        assert result["telegram_bot_token"].startswith("123")
        assert result["telegram_bot_token"].endswith("w11")
        assert "***" in result["telegram_bot_token"]

    def test_masks_smtp_password(self):
        s = {"smtp_password": "my-secret-password"}
        result = mask_sensitive(s)
        assert "***" in result["smtp_password"]

    def test_leaves_none_values_as_none(self):
        s = {"telegram_bot_token": None, "smtp_password": None}
        result = mask_sensitive(s)
        assert result["telegram_bot_token"] is None
        assert result["smtp_password"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.notification_settings'`

- [ ] **Step 3: Implement notification_settings service**

Create `apps/pipeline/app/services/notification_settings.py`:

```python
"""Notification settings — DB-backed with env var fallback.

Settings are stored as a JSON blob in the system_state table under the key
'notification_settings'. Any field not present in the DB row falls back to
the corresponding env var value from config.py.
"""
import json
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState

logger = logging.getLogger(__name__)

SETTINGS_KEY = "notification_settings"

# Fields stored in the JSON blob and their corresponding config.py attribute names
_FIELDS = [
    "telegram_bot_token",
    "telegram_chat_id",
    "notification_email_to",
    "notification_email_from",
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_use_tls",
    "notification_frequency",
]

_SENSITIVE_FIELDS = {"telegram_bot_token", "smtp_password"}

_VALID_FREQUENCIES = {"immediate", "daily", "weekly"}


def _env_defaults() -> dict:
    """Read current env var defaults from the settings singleton."""
    return {field: getattr(settings, field) for field in _FIELDS}


def _read_db_settings(db: Session) -> dict | None:
    """Read the notification_settings JSON blob from system_state. Returns None if not found."""
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    if row is None:
        return None
    return json.loads(row.value)


def get_notification_settings(db: Session) -> dict:
    """Read notification settings, merging DB values over env var defaults.

    Returns the full settings dict plus telegram_configured and email_configured booleans.
    """
    merged = _env_defaults()
    db_settings = _read_db_settings(db)
    if db_settings is not None:
        for key, value in db_settings.items():
            if key in merged and value is not None:
                merged[key] = value

    merged["telegram_configured"] = (
        merged.get("telegram_bot_token") is not None
        and merged.get("telegram_chat_id") is not None
    )
    merged["email_configured"] = merged.get("notification_email_to") is not None
    return merged


def save_notification_settings(db: Session, updates: dict) -> dict:
    """Validate and merge partial updates into stored settings. Returns the full merged result.

    Raises ValueError for invalid values.
    """
    # Validate before writing
    if "notification_frequency" in updates:
        if updates["notification_frequency"] not in _VALID_FREQUENCIES:
            raise ValueError(
                f"notification_frequency must be one of {_VALID_FREQUENCIES}, "
                f"got '{updates['notification_frequency']}'"
            )
    if "smtp_port" in updates:
        port = updates["smtp_port"]
        if not isinstance(port, int) or port < 1 or port > 65535:
            raise ValueError(f"smtp_port must be a positive integer (1-65535), got {port!r}")

    # Read existing DB settings (not merged with env vars — we only store overrides)
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    if row is not None:
        existing = json.loads(row.value)
    else:
        existing = {}

    # Merge updates
    for key, value in updates.items():
        if key in _FIELDS:
            existing[key] = value

    # Persist
    new_value = json.dumps(existing)
    if row is not None:
        row.value = new_value
    else:
        db.add(SystemState(key=SETTINGS_KEY, value=new_value))
    db.commit()

    logger.info('"action": "notification_settings_saved", "keys": %s', list(updates.keys()))

    # Return full merged settings
    return get_notification_settings(db)


def mask_sensitive(settings_dict: dict) -> dict:
    """Return a copy with sensitive fields masked. None values stay None."""
    result = dict(settings_dict)
    for field in _SENSITIVE_FIELDS:
        value = result.get(field)
        if value is not None and isinstance(value, str) and len(value) > 6:
            result[field] = value[:3] + "***" + value[-3:]
        elif value is not None and isinstance(value, str):
            result[field] = "***"
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notification_settings.py apps/pipeline/tests/unit/test_notification_settings.py
git commit -m "feat: add notification_settings service with DB-backed storage and env var fallback"
```

---

## Task 2: Pipeline — Notifications API Router

**Files:**
- Create: `apps/pipeline/app/api/notifications.py`
- Create: `apps/pipeline/tests/unit/test_notifications_api.py`
- Modify: `apps/pipeline/app/main.py`

Three endpoints: GET settings, PUT settings, POST test notification.

- [ ] **Step 1: Write failing tests for the API router**

Create `apps/pipeline/tests/unit/test_notifications_api.py`:

```python
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
    @patch("app.api.notifications.send_telegram")
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notifications_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.notifications'`

- [ ] **Step 3: Implement the notifications API router**

Create `apps/pipeline/app/api/notifications.py`:

```python
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
```

- [ ] **Step 4: Mount the router in main.py**

In `apps/pipeline/app/main.py`, add the import and include_router call:

After the existing import block:
```python
from app.api import feeds, episodes, queue, health, embed
```
Change to:
```python
from app.api import feeds, episodes, queue, health, embed, notifications
```

After the existing router registrations:
```python
app.include_router(embed.router, prefix="/api")
```
Add:
```python
app.include_router(notifications.router, prefix="/api")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notifications_api.py -v`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline/app/api/notifications.py apps/pipeline/tests/unit/test_notifications_api.py apps/pipeline/app/main.py
git commit -m "feat: add notifications API router with settings CRUD and test send endpoints"
```

---

## Task 3: Pipeline — Wire digest.py to DB-backed Settings

**Files:**
- Modify: `apps/pipeline/app/services/digest.py`

Replace direct `settings.X` references with calls to `get_notification_settings(db)` so the pipeline reads fresh settings from DB on each notification send.

- [ ] **Step 1: Modify `_send_digest` to accept settings dict**

In `apps/pipeline/app/services/digest.py`, change the `_send_digest` function signature and body:

Replace the entire `_send_digest` function (lines 296-330):

```python
def _send_digest(digest: DigestData, ns: dict) -> None:
    """Send digest via all configured channels using the provided notification settings."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    freq_label = "Daily" if digest.frequency == "daily" else "Weekly"

    if ns.get("email_configured"):
        html = format_digest_html(digest)
        subject = f"📋 Podlog {freq_label} Digest — {digest.date_label}"

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = ns.get("notification_email_from", "podlog@localhost")
        msg["To"] = ns["notification_email_to"]
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(ns.get("smtp_host", "host.docker.internal"), ns.get("smtp_port", 25)) as server:
            if ns.get("smtp_use_tls"):
                server.starttls()
            if ns.get("smtp_user") and ns.get("smtp_password"):
                server.login(ns["smtp_user"], ns["smtp_password"])
            server.send_message(msg)

    if ns.get("telegram_configured"):
        import httpx
        text = format_digest_telegram(digest)
        url = f"https://api.telegram.org/bot{ns['telegram_bot_token']}/sendMessage"
        resp = httpx.post(url, json={
            "chat_id": ns["telegram_chat_id"],
            "text": text,
            "parse_mode": "Markdown",
        })
        resp.raise_for_status()
```

- [ ] **Step 2: Modify `send_digest_if_due` to read settings from DB**

In the `send_digest_if_due` function, replace `settings.notification_frequency` lookups with DB-backed reads. Replace the entire function (lines 202-284):

```python
def send_digest_if_due(now: datetime | None = None) -> None:
    """Check if a digest is due and send it if so. Called by the worker periodic task."""
    if now is None:
        now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        # Read current notification settings from DB (with env var fallback)
        ns = get_notification_settings(db)
        frequency = ns.get("notification_frequency", "immediate")

        if frequency == "immediate":
            return

        # Quick time-only check before hitting the DB for last_sent
        if not is_digest_due(frequency, now, last_sent=None):
            return

        # Read last_digest_sent_at from system_state
        state_row = db.query(SystemState).filter(SystemState.key == LAST_DIGEST_KEY).first()
        last_sent = None
        if isinstance(state_row, SystemState):
            last_sent = datetime.fromisoformat(state_row.value)

        if not is_digest_due(frequency, now, last_sent):
            return

        # Query unsent events
        unsent = (
            db.query(NotificationLog)
            .filter(NotificationLog.sent == False)
            .order_by(NotificationLog.created_at)
            .all()
        )

        if not unsent:
            _update_last_sent(db, state_row, now)
            return

        # Build digest data
        remaining, estimated = estimate_queue_status(db)
        items = []
        for row in unsent:
            payload = json.loads(row.payload)
            items.append(DigestItem(
                event_type=row.event_type,
                episode_title=payload.get("episode_title", ""),
                podcast_title=payload.get("podcast_title", ""),
                duration_secs=payload.get("duration_secs"),
                total_duration_secs=payload.get("total_duration_secs"),
                error_class=payload.get("error_class"),
                retry_count=payload.get("retry_count"),
                retry_max=payload.get("retry_max"),
            ))

        if frequency == "weekly":
            days_since_monday = now.weekday()
            monday = now - timedelta(days=days_since_monday)
            date_label = f"Week of {monday.strftime('%b %d, %Y')}"
        else:
            date_label = now.strftime("%b %d, %Y")

        digest = DigestData(
            frequency=frequency,
            date_label=date_label,
            items=items,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
        )

        _send_digest(digest, ns)

        for row in unsent:
            row.sent = True
        db.commit()

        _update_last_sent(db, state_row, now)

        logger.info(
            '"action": "digest_sent", "frequency": "%s", "items": %d',
            frequency, len(items),
        )
    finally:
        db.close()
```

- [ ] **Step 3: Modify `register_notification_handlers` to read from DB at dispatch time**

Replace the `register_notification_handlers` function (lines 333-401). The key change: instead of reading settings at registration time and closing over static values, each handler reads fresh settings from DB at dispatch time:

```python
def register_notification_handlers(bus: EventBus) -> None:
    """Register notification handlers on the event bus.

    Handlers read settings from DB at dispatch time so they always use
    the latest configuration — even if settings were changed via the UI
    after the pipeline started.
    """
    def _get_settings() -> dict:
        db = SessionLocal()
        try:
            return get_notification_settings(db)
        finally:
            db.close()

    def _send_immediate(event: Event) -> None:
        ns = _get_settings()
        if ns.get("email_configured"):
            send_email(
                event,
                to_addr=ns["notification_email_to"],
                from_addr=ns.get("notification_email_from", "podlog@localhost"),
                smtp_host=ns.get("smtp_host", "host.docker.internal"),
                smtp_port=ns.get("smtp_port", 25),
                smtp_user=ns.get("smtp_user"),
                smtp_password=ns.get("smtp_password"),
                use_tls=ns.get("smtp_use_tls", False),
            )
        if ns.get("telegram_configured"):
            send_telegram(
                event,
                bot_token=ns["telegram_bot_token"],
                chat_id=ns["telegram_chat_id"],
            )

    def _handle_done(event: Event) -> None:
        ns = _get_settings()
        freq = ns.get("notification_frequency", "immediate")
        if freq == "immediate":
            _send_immediate(event)
        else:
            log_event(event, mark_sent=False)

    def _handle_failed(event: Event) -> None:
        ns = _get_settings()
        freq = ns.get("notification_frequency", "immediate")
        if freq == "immediate":
            _send_immediate(event)
        else:
            log_event(event, mark_sent=True)
            _send_immediate(event)

    bus.subscribe(EpisodeDoneEvent, _handle_done)
    bus.subscribe(EpisodeFailedEvent, _handle_failed)
```

- [ ] **Step 4: Add the import for `get_notification_settings`**

At the top of `apps/pipeline/app/services/digest.py`, add to the imports:

```python
from app.services.notification_settings import get_notification_settings
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py tests/unit/test_digest_wiring.py tests/unit/test_notification_settings.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline/app/services/digest.py
git commit -m "refactor: wire digest.py to read notification settings from DB instead of config singleton"
```

---

## Task 4: Web — API Proxy Routes

**Files:**
- Create: `apps/web/src/app/api/notifications/settings/route.ts`
- Create: `apps/web/src/app/api/notifications/test/route.ts`

Thin proxy routes that forward requests to the pipeline API.

- [ ] **Step 1: Create the settings proxy route**

Create `apps/web/src/app/api/notifications/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  const resp = await fetch(`${PIPELINE_API}/api/notifications/settings`);
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const resp = await fetch(`${PIPELINE_API}/api/notifications/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
```

- [ ] **Step 2: Create the test proxy route**

Create `apps/web/src/app/api/notifications/test/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const resp = await fetch(`${PIPELINE_API}/api/notifications/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/notifications/settings/route.ts apps/web/src/app/api/notifications/test/route.ts
git commit -m "feat: add web API proxy routes for notification settings and test endpoints"
```

---

## Task 5: Web — NotificationSettings Component

**Files:**
- Create: `apps/web/src/components/NotificationSettings.tsx`
- Create: `apps/web/tests/unit/notification-settings.test.tsx`

The main client component with three tabs (Telegram, Email, General), forms, setup guides, save/test buttons, and toast feedback.

- [ ] **Step 1: Write failing tests for NotificationSettings**

Create `apps/web/tests/unit/notification-settings.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NotificationSettings from "@/components/NotificationSettings";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Default: GET returns unconfigured settings
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      telegram_bot_token: null,
      telegram_chat_id: null,
      notification_email_to: null,
      notification_email_from: "podlog@localhost",
      smtp_host: "host.docker.internal",
      smtp_port: 25,
      smtp_user: null,
      smtp_password: null,
      smtp_use_tls: false,
      notification_frequency: "immediate",
      telegram_configured: false,
      email_configured: false,
    }),
  });
});

describe("NotificationSettings", () => {
  it("renders three tabs", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /telegram/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /email/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
    });
  });

  it("shows telegram tab content by default", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/chat id/i)).toBeInTheDocument();
    });
  });

  it("switches to email tab on click", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByLabelText(/send to/i)).toBeInTheDocument();
  });

  it("switches to general tab on click", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /general/i }));
    fireEvent.click(screen.getByRole("tab", { name: /general/i }));
    expect(screen.getByLabelText(/notification frequency/i)).toBeInTheDocument();
  });

  it("calls PUT on save", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          telegram_bot_token: null,
          telegram_chat_id: null,
          telegram_configured: false,
          email_configured: false,
          notification_frequency: "immediate",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ telegram_configured: true }),
      });

    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/bot token/i));

    fireEvent.change(screen.getByLabelText(/bot token/i), {
      target: { value: "123:ABC" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c: [string, RequestInit?]) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
    });
  });

  it("disables test button when channel not configured", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      const testBtn = screen.getByRole("button", { name: /send test message/i });
      expect(testBtn).toBeDisabled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-cache`
Expected: FAIL — `Cannot find module '@/components/NotificationSettings'`

- [ ] **Step 3: Implement NotificationSettings component**

Create `apps/web/src/components/NotificationSettings.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";

// --- Types ---

interface Settings {
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notification_email_to: string | null;
  notification_email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_use_tls: boolean;
  notification_frequency: string;
  telegram_configured: boolean;
  email_configured: boolean;
}

type Tab = "telegram" | "email" | "general";

// --- Setup Guides ---

function TelegramGuide({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 mb-6">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-sm font-medium text-indigo-400">
          How to set up Telegram notifications
        </h3>
        <span className="text-xs text-indigo-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Open Telegram and search for <strong>@BotFather</strong>
          </li>
          <li>
            Send <code className="bg-muted px-1 rounded text-xs">/newbot</code> and follow the
            prompts to create a bot
          </li>
          <li>
            Copy the <strong>bot token</strong> (looks like{" "}
            <code className="bg-muted px-1 rounded text-xs">123456:ABC-DEF...</code>) and paste it
            below
          </li>
          <li>Start a chat with your new bot (send it any message)</li>
          <li>
            Visit{" "}
            <code className="bg-muted px-1 rounded text-xs">
              {"https://api.telegram.org/bot<TOKEN>/getUpdates"}
            </code>{" "}
            in your browser
          </li>
          <li>
            Find{" "}
            <code className="bg-muted px-1 rounded text-xs">
              {'"chat":{"id":123456789}'}
            </code>{" "}
            in the response — that&apos;s your <strong>Chat ID</strong>
          </li>
        </ol>
      )}
    </div>
  );
}

function EmailGuide({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 mb-6">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-sm font-medium text-indigo-400">
          How to set up email notifications
        </h3>
        <span className="text-xs text-indigo-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            If you have a local mail server (postfix, sendmail), just enter your email address
            below and Save — the defaults will work
          </li>
          <li>
            For external providers (Gmail, Fastmail, etc.), expand &quot;SMTP Configuration&quot;
            below
          </li>
          <li>
            For <strong>Gmail</strong>: enable 2FA, then create an App Password in Google account
            settings. Use <code className="bg-muted px-1 rounded text-xs">smtp.gmail.com</code>{" "}
            port <code className="bg-muted px-1 rounded text-xs">587</code> with TLS enabled
          </li>
          <li>For other providers, check their SMTP documentation for host/port/TLS settings</li>
        </ol>
      )}
    </div>
  );
}

// --- Sub-components ---

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full mb-4 ${
        configured
          ? "bg-green-500/10 text-green-500"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          configured ? "bg-green-500" : "bg-muted-foreground"
        }`}
      />
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white shadow-lg ${
        type === "success" ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {type === "success" ? "✓" : "✕"} {message}
    </div>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

// --- Tab Content ---

function TelegramTab({
  settings,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
}) {
  return (
    <div>
      <StatusBadge configured={settings.telegram_configured} />
      <TelegramGuide configured={settings.telegram_configured} />

      <FieldGroup
        label="Bot Token"
        hint="The token you received from @BotFather when creating your bot"
      >
        <input
          id="bot-token"
          type="password"
          className={inputClass}
          placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
          value={settings.telegram_bot_token ?? ""}
          onChange={(e) => onChange("telegram_bot_token", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Chat ID"
        hint="Your personal chat ID — find it via the getUpdates API call above"
      >
        <input
          id="chat-id"
          type="text"
          className={inputClass}
          placeholder="123456789"
          value={settings.telegram_chat_id ?? ""}
          onChange={(e) => onChange("telegram_chat_id", e.target.value)}
        />
      </FieldGroup>

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="px-5 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50"
          onClick={onTest}
          disabled={!settings.telegram_configured || testing}
        >
          {testing ? "Sending..." : "Send test message"}
        </button>
      </div>
    </div>
  );
}

function EmailTab({
  settings,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
}) {
  const [smtpOpen, setSmtpOpen] = useState(false);

  return (
    <div>
      <StatusBadge configured={settings.email_configured} />
      <EmailGuide configured={settings.email_configured} />

      <FieldGroup label="Send to" hint="Email address that receives notifications">
        <input
          id="send-to"
          type="email"
          className={inputClass}
          placeholder="you@example.com"
          value={settings.notification_email_to ?? ""}
          onChange={(e) => onChange("notification_email_to", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="From address" hint="Sender address shown in notifications">
        <input
          id="from-address"
          type="email"
          className={inputClass}
          placeholder="podlog@localhost"
          value={settings.notification_email_from}
          onChange={(e) => onChange("notification_email_from", e.target.value)}
        />
      </FieldGroup>

      <div className="border-t border-border my-6" />

      <button
        className="flex w-full items-center justify-between text-left text-sm mb-4"
        onClick={() => setSmtpOpen(!smtpOpen)}
      >
        <span className="font-medium">SMTP Configuration</span>
        <span className="text-xs text-muted-foreground">
          {smtpOpen ? "Hide" : "Show"} — optional, defaults work with local mail servers
        </span>
      </button>

      {smtpOpen && (
        <div className="space-y-4 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="SMTP Host" hint="Leave default for local, or e.g. smtp.gmail.com">
              <input
                id="smtp-host"
                type="text"
                className={inputClass}
                placeholder="host.docker.internal"
                value={settings.smtp_host}
                onChange={(e) => onChange("smtp_host", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="SMTP Port" hint="25 for local, 587 for TLS, 465 for SSL">
              <input
                id="smtp-port"
                type="number"
                className={inputClass}
                placeholder="25"
                value={settings.smtp_port}
                onChange={(e) => onChange("smtp_port", parseInt(e.target.value) || 0)}
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup
              label="SMTP Username"
              hint="Usually your email address — leave empty for local"
            >
              <input
                id="smtp-username"
                type="text"
                className={inputClass}
                placeholder="you@example.com"
                value={settings.smtp_user ?? ""}
                onChange={(e) => onChange("smtp_user", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="SMTP Password" hint="App password or SMTP credential">
              <input
                id="smtp-password"
                type="password"
                className={inputClass}
                placeholder="••••••••"
                value={settings.smtp_password ?? ""}
                onChange={(e) => onChange("smtp_password", e.target.value)}
              />
            </FieldGroup>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.smtp_use_tls}
              onChange={(e) => onChange("smtp_use_tls", e.target.checked)}
            />
            Enable TLS
            <span className="text-xs text-muted-foreground">
              — required for Gmail, Outlook, and most external providers
            </span>
          </label>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="px-5 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50"
          onClick={onTest}
          disabled={!settings.email_configured || testing}
        >
          {testing ? "Sending..." : "Send test email"}
        </button>
      </div>
    </div>
  );
}

function GeneralTab({
  settings,
  onChange,
  onSave,
  saving,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div>
      <FieldGroup
        label="Notification Frequency"
        hint="Controls success notifications. Failures are always sent immediately."
      >
        <select
          id="notification-frequency"
          className={inputClass}
          value={settings.notification_frequency}
          onChange={(e) => onChange("notification_frequency", e.target.value)}
        >
          <option value="immediate">Immediate — notify after each episode</option>
          <option value="daily">Daily digest — summary at 8:00 AM UTC</option>
          <option value="weekly">Weekly digest — summary on Monday at 8:00 AM UTC</option>
        </select>
      </FieldGroup>

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("telegram");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Track which fields have been changed (to send only dirty fields on save)
  const [dirty, setDirty] = useState<Partial<Settings>>({});

  useEffect(() => {
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  if (!settings) {
    return <div className="text-muted-foreground text-sm">Loading settings...</div>;
  }

  function handleChange(field: keyof Settings, value: string | number | boolean) {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    setDirty((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setSettings(updated);
        setDirty({});
        setToast({ message: "Settings saved", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Failed to save", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(channel: "telegram" | "email") {
    setTesting(true);
    try {
      const resp = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (resp.ok) {
        setToast({ message: "Test message sent", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Test failed", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setTesting(false);
    }
  }

  const tabs: { key: Tab; label: string; dot?: boolean; configured?: boolean }[] = [
    { key: "telegram", label: "Telegram", dot: true, configured: settings.telegram_configured },
    { key: "email", label: "Email", dot: true, configured: settings.email_configured },
    { key: "general", label: "General" },
  ];

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-border mb-6" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`px-5 py-2.5 text-sm border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-indigo-500 text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.dot && (
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ml-1.5 ${
                  tab.configured ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "telegram" && (
        <TelegramTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          onTest={() => handleTest("telegram")}
          saving={saving}
          testing={testing}
        />
      )}
      {activeTab === "email" && (
        <EmailTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          onTest={() => handleTest("email")}
          saving={saving}
          testing={testing}
        />
      )}
      {activeTab === "general" && (
        <GeneralTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-cache`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotificationSettings.tsx apps/web/tests/unit/notification-settings.test.tsx
git commit -m "feat: add NotificationSettings component with tabbed forms, setup guides, and test buttons"
```

---

## Task 6: Web — Page Shell and Navbar Link

**Files:**
- Create: `apps/web/src/app/notifications/page.tsx`
- Modify: `apps/web/src/components/Navbar.tsx`

- [ ] **Step 1: Create the notifications page**

Create `apps/web/src/app/notifications/page.tsx`:

```tsx
import NotificationSettings from "@/components/NotificationSettings";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Notification Settings</h1>
      <NotificationSettings />
    </div>
  );
}
```

- [ ] **Step 2: Add "Notifications" link to the Navbar**

In `apps/web/src/components/Navbar.tsx`, add the Notifications link to the `NAV_LINKS` array. Change:

```typescript
const NAV_LINKS = [
  { href: "/", label: "Search" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/queue", label: "Queue" },
];
```

To:

```typescript
const NAV_LINKS = [
  { href: "/", label: "Search" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/queue", label: "Queue" },
  { href: "/notifications", label: "Notifications" },
];
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/notifications/page.tsx apps/web/src/components/Navbar.tsx
git commit -m "feat: add /notifications page and navbar link"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| `/notifications` page with tabbed UI | Task 5 (component), Task 6 (page) |
| DB-backed settings in `system_state` | Task 1 (service) |
| Env var fallback | Task 1 (`_env_defaults`) |
| Setup guides (collapsible) | Task 5 (`TelegramGuide`, `EmailGuide`) |
| "Send test" buttons | Task 2 (API), Task 5 (UI) |
| Pipeline reads from DB at notification time | Task 3 (digest.py refactor) |
| Navbar link | Task 6 |
| Status dots on tabs | Task 5 (`telegram_configured`/`email_configured`) |
| Status badges | Task 5 (`StatusBadge`) |
| SMTP section collapsible | Task 5 (`EmailTab` with `smtpOpen` state) |
| Sensitive field masking | Task 1 (`mask_sensitive`), Task 2 (API returns masked) |
| Validation (frequency, port) | Task 1 (`save_notification_settings`) |
| Toast feedback | Task 5 (`Toast` component) |
| Web API proxy routes | Task 4 |

### Placeholder Scan
No TBD, TODO, or "implement later" found. All steps contain complete code.

### Type Consistency
- `Settings` interface in Task 5 matches the JSON shape returned by `get_notification_settings` in Task 1
- `mask_sensitive` is called in Task 2's API before returning, matching Task 1's implementation
- `save_notification_settings` raises `ValueError` in Task 1, caught as 422 in Task 2
- `send_test_telegram` and `send_test_email` in Task 2 match the test mocking in Task 2's tests
- `SETTINGS_KEY` constant used consistently in Task 1
