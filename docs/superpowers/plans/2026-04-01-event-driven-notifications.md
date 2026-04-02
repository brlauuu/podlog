# Event-Driven Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-process event bus that sends email (HTML) and Telegram (Markdown) notifications when episodes complete or fail processing.

**Architecture:** A lightweight EventBus singleton holds a registry of event type -> handler subscriptions. Pipeline tasks emit typed event dataclasses at key moments. Handlers (email, Telegram) format and deliver notifications. Handlers are error-isolated — they never crash the pipeline.

**Tech Stack:** Python dataclasses, smtplib (email), httpx (Telegram), pydantic-settings (config)

**Spec:** `docs/superpowers/specs/2026-04-01-event-driven-notifications-design.md`
**Issue:** #91

---

### Task 1: EventBus Core

**Files:**
- Create: `apps/pipeline/app/services/events.py`
- Test: `apps/pipeline/tests/unit/test_events.py`

- [ ] **Step 1: Write failing tests for EventBus**

```python
# apps/pipeline/tests/unit/test_events.py
"""Tests for the in-process event bus."""
from dataclasses import dataclass

from app.services.events import Event, EventBus


@dataclass
class FakeEvent(Event):
    value: str = ""


def test_subscribe_and_emit():
    bus = EventBus()
    received = []
    bus.subscribe(FakeEvent, lambda e: received.append(e))
    event = FakeEvent(value="hello")
    bus.emit(event)
    assert received == [event]


def test_multiple_handlers():
    bus = EventBus()
    log1, log2 = [], []
    bus.subscribe(FakeEvent, lambda e: log1.append(e.value))
    bus.subscribe(FakeEvent, lambda e: log2.append(e.value))
    bus.emit(FakeEvent(value="x"))
    assert log1 == ["x"]
    assert log2 == ["x"]


def test_handler_error_does_not_propagate():
    bus = EventBus()
    results = []

    def bad_handler(e):
        raise RuntimeError("boom")

    def good_handler(e):
        results.append(e.value)

    bus.subscribe(FakeEvent, bad_handler)
    bus.subscribe(FakeEvent, good_handler)
    bus.emit(FakeEvent(value="ok"))
    assert results == ["ok"]


def test_no_cross_talk_between_event_types():
    @dataclass
    class OtherEvent(Event):
        x: int = 0

    bus = EventBus()
    fake_log, other_log = [], []
    bus.subscribe(FakeEvent, lambda e: fake_log.append(e))
    bus.subscribe(OtherEvent, lambda e: other_log.append(e))
    bus.emit(FakeEvent(value="a"))
    assert len(fake_log) == 1
    assert len(other_log) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_events.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.events'`

- [ ] **Step 3: Implement EventBus**

```python
# apps/pipeline/app/services/events.py
"""Lightweight in-process event bus."""
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger(__name__)


@dataclass
class Event:
    """Base class for all events."""
    pass


class EventBus:
    """Registry of event type -> handler subscriptions.

    Handlers are called synchronously. A failing handler is logged
    but never propagates — it must not affect the pipeline task.
    """

    def __init__(self) -> None:
        self._handlers: dict[type, list[Callable]] = defaultdict(list)

    def subscribe(self, event_type: type, handler: Callable) -> None:
        self._handlers[event_type].append(handler)

    def emit(self, event: Event) -> None:
        for handler in self._handlers.get(type(event), []):
            try:
                handler(event)
            except Exception:
                logger.exception(
                    '"action": "event_handler_error", "event": "%s", "handler": "%s"',
                    type(event).__name__,
                    getattr(handler, "__name__", repr(handler)),
                )


# Global bus instance — initialized on pipeline startup
bus = EventBus()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_events.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/events.py apps/pipeline/tests/unit/test_events.py
git commit -m "feat(notifications): add in-process EventBus core (#91)"
```

---

### Task 2: Notification Config

**Files:**
- Modify: `apps/pipeline/app/config.py`
- Modify: `apps/pipeline/.env.example` (if it exists at repo root, use that)
- Test: `apps/pipeline/tests/unit/test_notification_config.py`

- [ ] **Step 1: Write failing tests for config properties**

```python
# apps/pipeline/tests/unit/test_notification_config.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_config.py -v`
Expected: FAIL — `TypeError: unexpected keyword argument 'notification_email_to'`

- [ ] **Step 3: Add notification settings to config.py**

Add these fields to the `Settings` class in `apps/pipeline/app/config.py`, after the existing `spacy_model` field:

```python
    # Notifications (all optional — no env vars = no notifications)
    notification_email_to: str | None = None
    notification_email_from: str = "podlog@localhost"
    smtp_host: str = "host.docker.internal"
    smtp_port: int = 25
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = False

    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    @property
    def email_notifications_enabled(self) -> bool:
        return self.notification_email_to is not None

    @property
    def telegram_notifications_enabled(self) -> bool:
        return self.telegram_bot_token is not None and self.telegram_chat_id is not None
```

- [ ] **Step 4: Update .env.example**

Add to the end of `/home/brlauuu/repos/podlog/.env.example`:

```bash

# -- Notifications (optional — omit to disable) --
# NOTIFICATION_EMAIL_TO=you@example.com
# NOTIFICATION_EMAIL_FROM=podlog@localhost
# SMTP_HOST=host.docker.internal
# SMTP_PORT=25
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_USE_TLS=false
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_config.py -v`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline/app/config.py .env.example apps/pipeline/tests/unit/test_notification_config.py
git commit -m "feat(notifications): add notification config settings (#91)"
```

---

### Task 3: Event Types and Queue Estimation

**Files:**
- Create: `apps/pipeline/app/services/notifications.py`
- Test: `apps/pipeline/tests/unit/test_notifications.py`

- [ ] **Step 1: Write failing tests for event dataclasses and queue estimation**

```python
# apps/pipeline/tests/unit/test_notifications.py
"""Tests for notification event types and queue estimation."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    estimate_queue_status,
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


def test_estimate_queue_status_with_history():
    """With recent episodes, estimate uses duration-weighted rate."""
    db = MagicMock()

    # Mock recent completed episodes: 2 episodes, each 1800s audio, each took 900s to process
    # Processing rate = 1800s total wall / 3600s total audio = 0.5 wall-per-audio-sec
    recent_done = MagicMock()
    recent_done.all.return_value = [
        MagicMock(duration_secs=1800, created_at=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                  processed_at=datetime(2026, 1, 1, 0, 15, tzinfo=timezone.utc)),  # 900s
        MagicMock(duration_secs=1800, created_at=datetime(2026, 1, 1, 1, 0, tzinfo=timezone.utc),
                  processed_at=datetime(2026, 1, 1, 1, 15, tzinfo=timezone.utc)),  # 900s
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

    remaining, estimated = estimate_queue_status(db)
    assert remaining == 3
    # rate = 1800 / 3600 = 0.5, queued audio = 3600, estimate = 3600 * 0.5 = 1800
    assert estimated == 1800.0


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

    remaining, estimated = estimate_queue_status(db)
    assert remaining == 2
    assert estimated is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notifications.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.notifications'`

- [ ] **Step 3: Implement event types and queue estimation**

```python
# apps/pipeline/app/services/notifications.py
"""Notification events, queue estimation, and delivery handlers."""
import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Episode
from app.services.events import Event

logger = logging.getLogger(__name__)


@dataclass
class EpisodeDoneEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    transcribe_duration_secs: float | None = None
    diarize_duration_secs: float | None = None
    total_duration_secs: float | None = None
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


@dataclass
class EpisodeFailedEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    error_class: str = ""
    error_message: str = ""
    retry_count: int = 0
    retry_max: int = 3
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


def estimate_queue_status(db: Session) -> tuple[int, float | None]:
    """Return (remaining_count, estimated_seconds_to_complete).

    The estimate uses a duration-weighted processing rate from the last 10
    completed episodes. Returns None for estimate if no history is available.
    """
    # Count pending/in-progress episodes
    remaining = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .count()
    )

    # Get recent completed episodes for rate calculation
    recent = (
        db.query(Episode)
        .filter(
            Episode.status == "done",
            Episode.processed_at.isnot(None),
            Episode.duration_secs.isnot(None),
        )
        .order_by(Episode.processed_at.desc())
        .limit(10)
        .all()
    )

    if not recent:
        return remaining, None

    # Compute duration-weighted processing rate
    total_wall = 0.0
    total_audio = 0.0
    for ep in recent:
        wall_secs = (ep.processed_at - ep.created_at).total_seconds()
        total_wall += wall_secs
        total_audio += ep.duration_secs

    if total_audio == 0:
        return remaining, None

    rate = total_wall / total_audio  # wall seconds per audio second

    # Sum duration of queued episodes
    queued_episodes = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .all()
    )
    queued_audio = sum(ep.duration_secs or 0 for ep in queued_episodes)

    return remaining, queued_audio * rate
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notifications.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notifications.py apps/pipeline/tests/unit/test_notifications.py
git commit -m "feat(notifications): add event types and queue estimation (#91)"
```

---

### Task 4: Message Formatting

**Files:**
- Modify: `apps/pipeline/app/services/notifications.py`
- Test: `apps/pipeline/tests/unit/test_notification_formatting.py`

- [ ] **Step 1: Write failing tests for message formatting**

```python
# apps/pipeline/tests/unit/test_notification_formatting.py
"""Tests for notification message formatting (HTML email + Telegram Markdown)."""
from datetime import datetime, timezone

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    format_done_html,
    format_done_telegram,
    format_failed_html,
    format_failed_telegram,
)


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="abc",
        episode_title="How AI Works",
        podcast_title="Tech Talk",
        published_at=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.5,
        diarize_duration_secs=60.2,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=3600.0,
    )


def _make_failed_event() -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="abc",
        episode_title="How AI Works",
        podcast_title="Tech Talk",
        published_at=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc),
        duration_secs=3600,
        error_class="OOM",
        error_message="Out of memory during transcription",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=1800.0,
    )


def test_format_done_html_contains_key_info():
    html = format_done_html(_make_done_event())
    assert "Tech Talk" in html
    assert "How AI Works" in html
    assert "1:00:00" in html  # duration
    assert "2m 00s" in html or "2m 01s" in html  # transcribe time ~120s
    assert "1m 00s" in html  # diarize time ~60s
    assert "5" in html  # queue remaining
    assert "<html" in html.lower()


def test_format_done_telegram_contains_key_info():
    md = format_done_telegram(_make_done_event())
    assert "Tech Talk" in md
    assert "How AI Works" in md
    assert "1:00:00" in md
    assert "5" in md


def test_format_failed_html_contains_error():
    html = format_failed_html(_make_failed_event())
    assert "OOM" in html
    assert "Out of memory" in html
    assert "3/3" in html  # retries
    assert "<html" in html.lower()


def test_format_failed_telegram_contains_error():
    md = format_failed_telegram(_make_failed_event())
    assert "OOM" in md
    assert "Out of memory" in md
    assert "3/3" in md


def test_format_done_html_unknown_queue_estimate():
    event = _make_done_event()
    event.queue_estimated_secs = None
    html = format_done_html(event)
    assert "unknown" in html.lower()


def test_format_done_telegram_unknown_queue_estimate():
    event = _make_done_event()
    event.queue_estimated_secs = None
    md = format_done_telegram(event)
    assert "unknown" in md.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_formatting.py -v`
Expected: FAIL — `ImportError: cannot import name 'format_done_html'`

- [ ] **Step 3: Implement formatting functions**

Add to `apps/pipeline/app/services/notifications.py`:

```python
def _fmt_duration(secs: float | int | None) -> str:
    """Format seconds as h:mm:ss."""
    if secs is None:
        return "—"
    total = int(secs)
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    return f"{h}:{m:02d}:{s:02d}"


def _fmt_short_duration(secs: float | None) -> str:
    """Format seconds as Xm Ys for shorter durations."""
    if secs is None:
        return "—"
    total = int(secs)
    if total >= 3600:
        return _fmt_duration(secs)
    m, s = divmod(total, 60)
    return f"{m}m {s:02d}s"


def _fmt_date(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    return dt.strftime("%b %d, %Y")


def _fmt_estimate(secs: float | None) -> str:
    if secs is None:
        return "Unknown"
    return _fmt_duration(secs)


def format_done_html(event: EpisodeDoneEvent) -> str:
    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 520px; margin: 0 auto; padding: 16px;">
  <h2 style="color: #16a34a; margin-bottom: 4px;">&#9989; Episode Processed</h2>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
    <tr><td style="padding: 6px 12px; color: #666;">Podcast</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.podcast_title}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Episode</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.episode_title}</td></tr>
    <tr><td style="padding: 6px 12px; color: #666;">Published</td>
        <td style="padding: 6px 12px;">{_fmt_date(event.published_at)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Duration</td>
        <td style="padding: 6px 12px;">{_fmt_duration(event.duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Processing Time</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Transcription</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.transcribe_duration_secs)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Diarization</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.diarize_duration_secs)}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Total</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_short_duration(event.total_duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{event.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{_fmt_estimate(event.queue_estimated_secs)}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_done_telegram(event: EpisodeDoneEvent) -> str:
    return (
        f"*✅ Episode Processed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Processing Time*\n"
        f"`Transcription:  {_fmt_short_duration(event.transcribe_duration_secs)}`\n"
        f"`Diarization:    {_fmt_short_duration(event.diarize_duration_secs)}`\n"
        f"`Total:          {_fmt_short_duration(event.total_duration_secs)}`\n\n"
        f"*Queue:* {event.queue_remaining} remaining · Est. {_fmt_estimate(event.queue_estimated_secs)}"
    )


def format_failed_html(event: EpisodeFailedEvent) -> str:
    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 520px; margin: 0 auto; padding: 16px;">
  <h2 style="color: #dc2626; margin-bottom: 4px;">&#10060; Episode Failed</h2>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
    <tr><td style="padding: 6px 12px; color: #666;">Podcast</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.podcast_title}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Episode</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.episode_title}</td></tr>
    <tr><td style="padding: 6px 12px; color: #666;">Published</td>
        <td style="padding: 6px 12px;">{_fmt_date(event.published_at)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Duration</td>
        <td style="padding: 6px 12px;">{_fmt_duration(event.duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px; color: #dc2626;">Error</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Class</td>
        <td style="padding: 4px 12px; font-weight: 600;">{event.error_class}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Details</td>
        <td style="padding: 4px 12px;">{event.error_message}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Retries</td>
        <td style="padding: 4px 12px;">{event.retry_count}/{event.retry_max}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{event.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{_fmt_estimate(event.queue_estimated_secs)}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_failed_telegram(event: EpisodeFailedEvent) -> str:
    return (
        f"*❌ Episode Failed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Error*\n"
        f"`Class:    {event.error_class}`\n"
        f"`Details:  {event.error_message}`\n"
        f"`Retries:  {event.retry_count}/{event.retry_max}`\n\n"
        f"*Queue:* {event.queue_remaining} remaining · Est. {_fmt_estimate(event.queue_estimated_secs)}"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_formatting.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notifications.py apps/pipeline/tests/unit/test_notification_formatting.py
git commit -m "feat(notifications): add HTML and Telegram message formatting (#91)"
```

---

### Task 5: Email Handler

**Files:**
- Modify: `apps/pipeline/app/services/notifications.py`
- Test: `apps/pipeline/tests/unit/test_email_handler.py`

- [ ] **Step 1: Write failing tests for email handler**

```python
# apps/pipeline/tests/unit/test_email_handler.py
"""Tests for the email notification handler."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent, send_email


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


@patch("app.services.notifications.smtplib")
def test_send_email_done_event(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    send_email(
        _make_done_event(),
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="localhost",
        smtp_port=25,
    )

    mock_smtp.send_message.assert_called_once()
    msg = mock_smtp.send_message.call_args[0][0]
    assert msg["To"] == "user@example.com"
    assert msg["From"] == "podlog@localhost"
    assert "Test Ep" in msg["Subject"]


@patch("app.services.notifications.smtplib")
def test_send_email_with_tls_and_auth(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    send_email(
        _make_done_event(),
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="smtp.gmail.com",
        smtp_port=587,
        smtp_user="user",
        smtp_password="pass",
        use_tls=True,
    )

    mock_smtp.starttls.assert_called_once()
    mock_smtp.login.assert_called_once_with("user", "pass")


@patch("app.services.notifications.smtplib")
def test_send_email_failed_event(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    event = EpisodeFailedEvent(
        episode_id="abc",
        episode_title="Bad Ep",
        podcast_title="Test Pod",
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=0,
        queue_estimated_secs=None,
    )

    send_email(
        event,
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="localhost",
        smtp_port=25,
    )

    msg = mock_smtp.send_message.call_args[0][0]
    assert "Failed" in msg["Subject"] or "failed" in msg["Subject"].lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_email_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'send_email'`

- [ ] **Step 3: Implement send_email**

Add to `apps/pipeline/app/services/notifications.py`:

```python
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def send_email(
    event: Event,
    to_addr: str,
    from_addr: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    use_tls: bool = False,
) -> None:
    """Send an HTML notification email for the given event."""
    if isinstance(event, EpisodeDoneEvent):
        subject = f"✅ Podlog: {event.episode_title} processed"
        html = format_done_html(event)
    elif isinstance(event, EpisodeFailedEvent):
        subject = f"❌ Podlog: {event.episode_title} failed"
        html = format_failed_html(event)
    else:
        logger.warning('"action": "email_unknown_event", "type": "%s"', type(event).__name__)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        if use_tls:
            server.starttls()
        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)
        server.send_message(msg)

    logger.info('"action": "email_sent", "to": "%s", "subject": "%s"', to_addr, subject)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_email_handler.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notifications.py apps/pipeline/tests/unit/test_email_handler.py
git commit -m "feat(notifications): add email delivery handler (#91)"
```

---

### Task 6: Telegram Handler

**Files:**
- Modify: `apps/pipeline/app/services/notifications.py`
- Test: `apps/pipeline/tests/unit/test_telegram_handler.py`

- [ ] **Step 1: Write failing tests for Telegram handler**

```python
# apps/pipeline/tests/unit/test_telegram_handler.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_telegram_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'send_telegram'`

- [ ] **Step 3: Implement send_telegram**

Add to `apps/pipeline/app/services/notifications.py`:

```python
import httpx


def send_telegram(
    event: Event,
    bot_token: str,
    chat_id: str,
) -> None:
    """Send a Markdown notification via Telegram Bot API."""
    if isinstance(event, EpisodeDoneEvent):
        text = format_done_telegram(event)
    elif isinstance(event, EpisodeFailedEvent):
        text = format_failed_telegram(event)
    else:
        logger.warning('"action": "telegram_unknown_event", "type": "%s"', type(event).__name__)
        return

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = httpx.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    })
    resp.raise_for_status()

    logger.info('"action": "telegram_sent", "chat_id": "%s"', chat_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_telegram_handler.py -v`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notifications.py apps/pipeline/tests/unit/test_telegram_handler.py
git commit -m "feat(notifications): add Telegram delivery handler (#91)"
```

---

### Task 7: Wire Into Pipeline

**Files:**
- Modify: `apps/pipeline/app/tasks/archive.py`
- Modify: `apps/pipeline/app/worker.py`
- Modify: `apps/pipeline/app/main.py`
- Test: `apps/pipeline/tests/unit/test_notification_wiring.py`

- [ ] **Step 1: Write failing tests for event emission wiring**

```python
# apps/pipeline/tests/unit/test_notification_wiring.py
"""Tests for notification event emission from pipeline tasks."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.events import EventBus
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent


@patch("app.tasks.archive.bus")
@patch("app.tasks.archive.estimate_queue_status", return_value=(3, 900.0))
@patch("app.tasks.archive.SessionLocal")
def test_archive_emits_done_event(mock_session_cls, mock_estimate, mock_bus):
    """archive_episode emits EpisodeDoneEvent on success."""
    db = MagicMock()
    mock_session_cls.return_value = db

    episode = MagicMock()
    episode.id = "ep1"
    episode.title = "Test"
    episode.audio_local_path = None
    episode.has_diarization = True
    episode.duration_secs = 3600
    episode.transcribe_duration_secs = 120.0
    episode.diarize_duration_secs = 60.0
    episode.created_at = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    episode.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    episode.feed = MagicMock()
    episode.feed.title = "My Podcast"

    # First query returns episode, second returns segments, third returns speaker_names
    # Fourth (re-query after expire_all) returns verified episode
    verified = MagicMock()
    verified.status = "done"
    verified.processed_at = datetime(2026, 1, 1, 0, 3, 20, tzinfo=timezone.utc)

    db.query.return_value.filter.return_value.first.side_effect = [episode, verified]
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
        MagicMock(start_time=0, end_time=10, text="hello", speaker_label="SPEAKER_00")
    ]
    db.query.return_value.filter.return_value.all.return_value = []  # speaker_names

    from app.tasks.archive import archive_episode
    archive_episode("ep1")

    mock_bus.emit.assert_called_once()
    event = mock_bus.emit.call_args[0][0]
    assert isinstance(event, EpisodeDoneEvent)
    assert event.episode_title == "Test"
    assert event.podcast_title == "My Podcast"
    assert event.queue_remaining == 3


@patch("app.tasks.helpers.bus")
@patch("app.tasks.helpers.estimate_queue_status", return_value=(2, None))
def test_worker_emits_failed_event_on_terminal_failure(mock_estimate, mock_bus):
    """mark_failed emits EpisodeFailedEvent when episode reaches terminal failure."""
    db = MagicMock()
    episode = MagicMock()
    episode.id = "ep1"
    episode.title = "Bad Ep"
    episode.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    episode.duration_secs = 1800
    episode.retry_count = 3
    episode.retry_max = 3
    episode.feed = MagicMock()
    episode.feed.title = "Pod"

    db.query.return_value.filter.return_value.first.return_value = episode

    from app.tasks.helpers import mark_failed
    mark_failed(db, "ep1", "OOM", "Out of memory")

    mock_bus.emit.assert_called_once()
    event = mock_bus.emit.call_args[0][0]
    assert isinstance(event, EpisodeFailedEvent)
    assert event.error_class == "OOM"


@patch("app.tasks.helpers.bus")
@patch("app.tasks.helpers.estimate_queue_status", return_value=(2, None))
def test_no_failed_event_on_retryable_failure(mock_estimate, mock_bus):
    """mark_failed does NOT emit when retries remain."""
    db = MagicMock()
    episode = MagicMock()
    episode.id = "ep1"
    episode.retry_count = 1
    episode.retry_max = 3

    db.query.return_value.filter.return_value.first.return_value = episode

    from app.tasks.helpers import mark_failed
    mark_failed(db, "ep1", "TRANSIENT_NETWORK", "timeout")

    mock_bus.emit.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_wiring.py -v`
Expected: FAIL — `AttributeError: module 'app.tasks.archive' has no attribute 'bus'`

- [ ] **Step 3: Modify archive.py to emit EpisodeDoneEvent**

Add imports at the top of `apps/pipeline/app/tasks/archive.py`:

```python
from app.services.events import bus
from app.services.notifications import EpisodeDoneEvent, estimate_queue_status
```

After the verified-status check (after line 96), before the raw audio deletion, add:

```python
        # Emit notification event
        remaining, estimated = estimate_queue_status(db)
        total_secs = (
            (verified.processed_at - episode.created_at).total_seconds()
            if verified.processed_at else None
        )
        bus.emit(EpisodeDoneEvent(
            episode_id=episode_id,
            episode_title=episode.title or "",
            podcast_title=episode.feed.title if episode.feed else "",
            published_at=episode.published_at,
            duration_secs=episode.duration_secs,
            transcribe_duration_secs=episode.transcribe_duration_secs,
            diarize_duration_secs=episode.diarize_duration_secs,
            total_duration_secs=total_secs,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
        ))
```

- [ ] **Step 4: Modify helpers.py to emit EpisodeFailedEvent on terminal failure**

Add imports at the top of `apps/pipeline/app/tasks/helpers.py`:

```python
from app.services.events import bus
from app.services.notifications import EpisodeFailedEvent, estimate_queue_status
```

In `mark_failed()`, after the `db.commit()` inside `update_episode`, add a check at the end of the function:

```python
def mark_failed(db, episode_id: str, error_class: str, error_message: str) -> None:
    """Mark an episode as failed with error classification."""
    update_episode(
        db, episode_id,
        status="failed",
        error_class=error_class,
        error_message=error_message,
    )
    logger.error(
        '"action": "task_error", "episode_id": "%s", "error_class": "%s", "error": "%s"',
        episode_id, error_class, error_message,
    )

    # Emit failure notification only on terminal failure (retries exhausted)
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if episode and episode.retry_count >= episode.retry_max:
        remaining, estimated = estimate_queue_status(db)
        bus.emit(EpisodeFailedEvent(
            episode_id=episode_id,
            episode_title=episode.title or "",
            podcast_title=episode.feed.title if episode.feed else "",
            published_at=episode.published_at,
            duration_secs=episode.duration_secs,
            error_class=error_class,
            error_message=error_message,
            retry_count=episode.retry_count,
            retry_max=episode.retry_max,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
        ))
```

- [ ] **Step 5: Register handlers on startup in main.py**

Add to `apps/pipeline/app/main.py`, after the existing imports:

```python
from app.config import settings
from app.services.events import bus
from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    send_email,
    send_telegram,
)
```

After the `app = FastAPI(...)` line, add handler registration:

```python
# Register notification handlers based on config
if settings.email_notifications_enabled:
    def _email_handler(event):
        send_email(
            event,
            to_addr=settings.notification_email_to,
            from_addr=settings.notification_email_from,
            smtp_host=settings.smtp_host,
            smtp_port=settings.smtp_port,
            smtp_user=settings.smtp_user,
            smtp_password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
        )
    bus.subscribe(EpisodeDoneEvent, _email_handler)
    bus.subscribe(EpisodeFailedEvent, _email_handler)

if settings.telegram_notifications_enabled:
    def _telegram_handler(event):
        send_telegram(event, bot_token=settings.telegram_bot_token, chat_id=settings.telegram_chat_id)
    bus.subscribe(EpisodeDoneEvent, _telegram_handler)
    bus.subscribe(EpisodeFailedEvent, _telegram_handler)
```

Also register in `apps/pipeline/app/worker.py` in the `main()` function, after the logging setup and before the worker loop:

```python
from app.config import settings
from app.services.events import bus
from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    send_email,
    send_telegram,
)

# Register notification handlers (worker runs the tasks that emit events)
if settings.email_notifications_enabled:
    def _email_handler(event):
        send_email(
            event,
            to_addr=settings.notification_email_to,
            from_addr=settings.notification_email_from,
            smtp_host=settings.smtp_host,
            smtp_port=settings.smtp_port,
            smtp_user=settings.smtp_user,
            smtp_password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
        )
    bus.subscribe(EpisodeDoneEvent, _email_handler)
    bus.subscribe(EpisodeFailedEvent, _email_handler)

if settings.telegram_notifications_enabled:
    def _telegram_handler(event):
        send_telegram(event, bot_token=settings.telegram_bot_token, chat_id=settings.telegram_chat_id)
    bus.subscribe(EpisodeDoneEvent, _telegram_handler)
    bus.subscribe(EpisodeFailedEvent, _telegram_handler)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_wiring.py -v`
Expected: All 3 tests PASS

- [ ] **Step 7: Run full test suite**

Run: `cd apps/pipeline && python -m pytest tests/unit/ -v`
Expected: All tests PASS (existing + new)

- [ ] **Step 8: Commit**

```bash
git add apps/pipeline/app/tasks/archive.py apps/pipeline/app/tasks/helpers.py apps/pipeline/app/main.py apps/pipeline/app/worker.py apps/pipeline/tests/unit/test_notification_wiring.py
git commit -m "feat(notifications): wire event emission and handler registration (#91)"
```
