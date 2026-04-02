# Notification Frequency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate/daily/weekly notification frequency modes, where success events are batched into digests and failure events always send immediately.

**Architecture:** A new `notification_log` DB table accumulates events. In `immediate` mode, handlers send directly (current behavior). In `daily`/`weekly` mode, success events are logged to the table; a periodic task checks every 15 minutes if a digest is due, formats all unsent events into a single message, and sends it. Failure events bypass batching and always send immediately.

**Tech Stack:** SQLAlchemy (new model), existing event bus, existing send_email/send_telegram, worker periodic tasks

**Spec:** `docs/superpowers/specs/2026-04-01-notification-frequency-design.md`
**Issue:** #92

---

### Task 1: NotificationLog Model + Config

**Files:**
- Modify: `apps/pipeline/app/models.py`
- Modify: `apps/pipeline/app/config.py`
- Modify: `.env.example`
- Test: `apps/pipeline/tests/unit/test_notification_frequency_config.py`

- [ ] **Step 1: Write failing tests for config**

```python
# apps/pipeline/tests/unit/test_notification_frequency_config.py
"""Tests for notification frequency config."""


def test_notification_frequency_defaults_to_immediate():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t")
    assert s.notification_frequency == "immediate"


def test_notification_frequency_accepts_daily():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t", notification_frequency="daily")
    assert s.notification_frequency == "daily"


def test_notification_frequency_accepts_weekly():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t", notification_frequency="weekly")
    assert s.notification_frequency == "weekly"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_frequency_config.py -v`
Expected: FAIL — `TypeError: unexpected keyword argument 'notification_frequency'`

- [ ] **Step 3: Add notification_frequency to config.py**

In `apps/pipeline/app/config.py`, add after the `telegram_chat_id` field (line 54):

```python
    notification_frequency: str = "immediate"  # immediate | daily | weekly
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_frequency_config.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Add NotificationLog model to models.py**

In `apps/pipeline/app/models.py`, add after the `SystemState` class (at the end of the file):

```python
class NotificationLog(Base):
    """Accumulated notification events for digest delivery."""

    __tablename__ = "notification_log"
    __table_args__ = (
        Index("idx_notification_log_unsent", "sent", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
```

- [ ] **Step 6: Update .env.example**

Add after the `# TELEGRAM_CHAT_ID=` line in `.env.example`:

```bash
# NOTIFICATION_FREQUENCY=immediate  # immediate | daily | weekly
```

- [ ] **Step 7: Commit**

```bash
git add apps/pipeline/app/models.py apps/pipeline/app/config.py .env.example apps/pipeline/tests/unit/test_notification_frequency_config.py
git commit -m "feat(digest): add NotificationLog model and frequency config (#92)"
```

---

### Task 2: Event Logging Handler

**Files:**
- Create: `apps/pipeline/app/services/digest.py`
- Test: `apps/pipeline/tests/unit/test_digest.py`

- [ ] **Step 1: Write failing tests for log_event**

```python
# apps/pipeline/tests/unit/test_digest.py
"""Tests for notification digest — event logging and digest scheduling."""
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent
from app.services.digest import log_event


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="ep1",
        episode_title="Test Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=1000.0,
    )


def _make_failed_event() -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="ep2",
        episode_title="Bad Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=1800,
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=500.0,
    )


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_done_event(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_done_event()
    log_event(event)

    db.add.assert_called_once()
    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.done"
    assert log_row.episode_id == "ep1"
    assert log_row.sent is False
    payload = json.loads(log_row.payload)
    assert payload["episode_title"] == "Test Ep"
    db.commit.assert_called_once()
    db.close.assert_called_once()


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_failed_event_as_sent(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_failed_event()
    log_event(event, mark_sent=True)

    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.failed"
    assert log_row.episode_id == "ep2"
    assert log_row.sent is True
    db.commit.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py::test_log_event_inserts_done_event tests/unit/test_digest.py::test_log_event_inserts_failed_event_as_sent -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.digest'`

- [ ] **Step 3: Implement log_event**

```python
# apps/pipeline/app/services/digest.py
"""Notification digest — event logging, scheduling, and digest formatting/delivery."""
import json
import logging
from dataclasses import asdict
from datetime import datetime

from app.database import SessionLocal
from app.models import NotificationLog
from app.services.events import Event
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent

logger = logging.getLogger(__name__)


def _serialize_event(event: Event) -> str:
    """Serialize an event dataclass to JSON, handling datetime fields."""
    data = asdict(event)
    for key, value in data.items():
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return json.dumps(data)


def log_event(event: Event, mark_sent: bool = False) -> None:
    """Write an event to the notification_log table.

    Args:
        event: The event to log.
        mark_sent: If True, mark the row as already sent (used for failed events
                   that are sent immediately but still logged for digest inclusion).
    """
    if isinstance(event, EpisodeDoneEvent):
        event_type = "episode.done"
        episode_id = event.episode_id
    elif isinstance(event, EpisodeFailedEvent):
        event_type = "episode.failed"
        episode_id = event.episode_id
    else:
        logger.warning('"action": "digest_log_unknown_event", "type": "%s"', type(event).__name__)
        return

    db = SessionLocal()
    try:
        row = NotificationLog(
            event_type=event_type,
            episode_id=episode_id,
            payload=_serialize_event(event),
            sent=mark_sent,
        )
        db.add(row)
        db.commit()
        logger.info(
            '"action": "event_logged", "event_type": "%s", "episode_id": "%s", "sent": %s',
            event_type, episode_id, mark_sent,
        )
    finally:
        db.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py -v`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/digest.py apps/pipeline/tests/unit/test_digest.py
git commit -m "feat(digest): add event logging handler (#92)"
```

---

### Task 3: Digest Scheduling Logic

**Files:**
- Modify: `apps/pipeline/app/services/digest.py`
- Test: `apps/pipeline/tests/unit/test_digest.py` (append)

- [ ] **Step 1: Write failing tests for is_digest_due**

Append to `apps/pipeline/tests/unit/test_digest.py`:

```python
from app.services.digest import is_digest_due


def test_digest_not_due_in_immediate_mode():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("immediate", now, last_sent=None) is False


def test_daily_digest_due_after_8am_never_sent():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is True


def test_daily_digest_not_due_before_8am():
    now = datetime(2026, 3, 15, 7, 59, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is False


def test_daily_digest_not_due_if_already_sent_today():
    now = datetime(2026, 3, 15, 10, 0, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is False


def test_daily_digest_due_next_day():
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is True


def test_weekly_digest_due_on_monday_after_8am():
    # March 16, 2026 is a Monday
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is True


def test_weekly_digest_not_due_on_tuesday():
    # March 17, 2026 is a Tuesday
    now = datetime(2026, 3, 17, 8, 30, tzinfo=timezone.utc)
    last = datetime(2026, 3, 16, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=last) is False


def test_weekly_digest_not_due_on_monday_before_8am():
    now = datetime(2026, 3, 16, 7, 0, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is False


def test_weekly_digest_due_next_monday():
    now = datetime(2026, 3, 23, 9, 0, tzinfo=timezone.utc)  # next Monday
    last = datetime(2026, 3, 16, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=last) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py::test_digest_not_due_in_immediate_mode -v`
Expected: FAIL — `ImportError: cannot import name 'is_digest_due'`

- [ ] **Step 3: Implement is_digest_due**

Add to `apps/pipeline/app/services/digest.py`:

```python
DIGEST_HOUR = 8  # 8am UTC


def is_digest_due(frequency: str, now: datetime, last_sent: datetime | None) -> bool:
    """Check whether a digest should be sent now.

    Args:
        frequency: "immediate", "daily", or "weekly"
        now: Current UTC datetime
        last_sent: When the last digest was sent (None if never)

    Returns:
        True if a digest should be sent now.
    """
    if frequency == "immediate":
        return False

    if now.hour < DIGEST_HOUR:
        return False

    if frequency == "daily":
        # Due if we haven't sent one today at/after DIGEST_HOUR
        today_digest_time = now.replace(hour=DIGEST_HOUR, minute=0, second=0, microsecond=0)
        if last_sent is None or last_sent < today_digest_time:
            return True
        return False

    if frequency == "weekly":
        # Monday = 0
        if now.weekday() != 0:
            # Not Monday — only due if we haven't sent since last Monday
            # Find the most recent Monday 8am
            days_since_monday = now.weekday()
            last_monday = (now - __import__('datetime').timedelta(days=days_since_monday)).replace(
                hour=DIGEST_HOUR, minute=0, second=0, microsecond=0
            )
            if last_sent is None or last_sent < last_monday:
                return True
            return False
        # It is Monday
        today_digest_time = now.replace(hour=DIGEST_HOUR, minute=0, second=0, microsecond=0)
        if last_sent is None or last_sent < today_digest_time:
            return True
        return False

    return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/digest.py apps/pipeline/tests/unit/test_digest.py
git commit -m "feat(digest): add digest scheduling logic (#92)"
```

---

### Task 4: Digest Formatting

**Files:**
- Modify: `apps/pipeline/app/services/digest.py`
- Test: `apps/pipeline/tests/unit/test_digest_formatting.py`

- [ ] **Step 1: Write failing tests for digest formatting**

```python
# apps/pipeline/tests/unit/test_digest_formatting.py
"""Tests for digest message formatting (HTML + Telegram)."""
import json
from datetime import datetime, timezone

from app.services.digest import format_digest_html, format_digest_telegram, DigestData, DigestItem


def _make_digest_data() -> DigestData:
    return DigestData(
        frequency="daily",
        date_label="Apr 01, 2026",
        items=[
            DigestItem(
                event_type="episode.done",
                episode_title="How AI Works",
                podcast_title="Tech Talk",
                duration_secs=3600,
                total_duration_secs=200.0,
                error_class=None,
                retry_count=None,
                retry_max=None,
            ),
            DigestItem(
                event_type="episode.done",
                episode_title="Episode 42",
                podcast_title="My Podcast",
                duration_secs=2700,
                total_duration_secs=130.0,
                error_class=None,
                retry_count=None,
                retry_max=None,
            ),
            DigestItem(
                event_type="episode.failed",
                episode_title="Bad Episode",
                podcast_title="Other Pod",
                duration_secs=1800,
                total_duration_secs=None,
                error_class="OOM",
                retry_count=3,
                retry_max=3,
            ),
        ],
        queue_remaining=5,
        queue_estimated_secs=9000.0,
    )


def test_format_digest_html_contains_summary():
    html = format_digest_html(_make_digest_data())
    assert "<html" in html.lower()
    assert "Daily Digest" in html
    assert "Apr 01, 2026" in html
    assert "How AI Works" in html
    assert "Episode 42" in html
    assert "Bad Episode" in html
    assert "OOM" in html
    assert "5" in html  # queue remaining


def test_format_digest_telegram_contains_summary():
    md = format_digest_telegram(_make_digest_data())
    assert "Daily Digest" in md
    assert "How AI Works" in md
    assert "Bad Episode" in md
    assert "OOM" in md
    assert "5" in md


def test_format_digest_html_weekly_label():
    data = _make_digest_data()
    data.frequency = "weekly"
    data.date_label = "Week of Mar 30, 2026"
    html = format_digest_html(data)
    assert "Weekly Digest" in html
    assert "Week of Mar 30, 2026" in html


def test_format_digest_html_unknown_queue_estimate():
    data = _make_digest_data()
    data.queue_estimated_secs = None
    html = format_digest_html(data)
    assert "unknown" in html.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest_formatting.py -v`
Expected: FAIL — `ImportError: cannot import name 'format_digest_html'`

- [ ] **Step 3: Implement digest data classes and formatters**

Add to `apps/pipeline/app/services/digest.py`:

```python
from dataclasses import dataclass, field


@dataclass
class DigestItem:
    event_type: str  # "episode.done" or "episode.failed"
    episode_title: str
    podcast_title: str
    duration_secs: int | None
    total_duration_secs: float | None  # processing time (done events)
    error_class: str | None  # failure events
    retry_count: int | None
    retry_max: int | None


@dataclass
class DigestData:
    frequency: str  # "daily" or "weekly"
    date_label: str  # e.g. "Apr 01, 2026" or "Week of Mar 30, 2026"
    items: list[DigestItem] = field(default_factory=list)
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


def format_digest_html(data: DigestData) -> str:
    freq_label = "Daily" if data.frequency == "daily" else "Weekly"
    done_count = sum(1 for i in data.items if i.event_type == "episode.done")
    failed_count = sum(1 for i in data.items if i.event_type == "episode.failed")

    rows = ""
    for idx, item in enumerate(data.items):
        bg = ' style="background: #f9f9f9;"' if idx % 2 == 1 else ""
        if item.event_type == "episode.done":
            icon = "&#9989;"
            detail = f"processed in {_fmt_short_duration(item.total_duration_secs)}"
        else:
            detail = f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            icon = "&#10060;"
        duration = _fmt_duration(item.duration_secs)
        rows += (
            f'    <tr{bg}><td style="padding: 6px 12px;">{icon}</td>'
            f'<td style="padding: 6px 12px;">{item.episode_title}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{item.podcast_title}</td>'
            f'<td style="padding: 6px 12px;">{duration}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{detail}</td></tr>\n'
        )

    est = _fmt_estimate(data.queue_estimated_secs)

    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 16px;">
  <h2 style="margin-bottom: 4px;">&#128203; Podlog {freq_label} Digest — {data.date_label}</h2>
  <p style="color: #666;">{done_count} episodes processed, {failed_count} failed</p>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
{rows}  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{data.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{est}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_digest_telegram(data: DigestData) -> str:
    freq_label = "Daily" if data.frequency == "daily" else "Weekly"
    done_count = sum(1 for i in data.items if i.event_type == "episode.done")
    failed_count = sum(1 for i in data.items if i.event_type == "episode.failed")

    lines = [
        f"*📋 Podlog {freq_label} Digest — {data.date_label}*\n",
        f"{done_count} episodes processed, {failed_count} failed\n",
    ]
    for item in data.items:
        duration = _fmt_duration(item.duration_secs)
        if item.event_type == "episode.done":
            detail = f"processed in {_fmt_short_duration(item.total_duration_secs)}"
            lines.append(f"✅ \"{item.episode_title}\" ({item.podcast_title}) — {duration}, {detail}")
        else:
            lines.append(
                f"❌ \"{item.episode_title}\" ({item.podcast_title}) — "
                f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            )

    est = _fmt_estimate(data.queue_estimated_secs)
    lines.append(f"\n*Queue:* {data.queue_remaining} remaining · Est. {est}")
    return "\n".join(lines)
```

Note: The `_fmt_duration`, `_fmt_short_duration`, and `_fmt_estimate` functions need to be imported from `notifications.py`. Add this import at the top of `digest.py`:

```python
from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    _fmt_duration,
    _fmt_short_duration,
    _fmt_estimate,
    estimate_queue_status,
    send_email,
    send_telegram,
)
```

And remove the duplicate individual imports of `EpisodeDoneEvent` and `EpisodeFailedEvent` that were added in Task 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest_formatting.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/digest.py apps/pipeline/tests/unit/test_digest_formatting.py
git commit -m "feat(digest): add digest data classes and formatters (#92)"
```

---

### Task 5: send_digest_if_due Periodic Task

**Files:**
- Modify: `apps/pipeline/app/services/digest.py`
- Test: `apps/pipeline/tests/unit/test_digest.py` (append)

- [ ] **Step 1: Write failing tests for send_digest_if_due**

Append to `apps/pipeline/tests/unit/test_digest.py`:

```python
from app.services.digest import send_digest_if_due, DigestItem


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.send_email")
@patch("app.services.digest.send_telegram")
@patch("app.services.digest.estimate_queue_status", return_value=(3, 900.0))
@patch("app.services.digest.settings")
def test_send_digest_sends_when_due(mock_settings, mock_estimate, mock_tg, mock_email, mock_session_cls):
    mock_settings.notification_frequency = "daily"
    mock_settings.email_notifications_enabled = True
    mock_settings.telegram_notifications_enabled = False
    mock_settings.notification_email_to = "user@example.com"
    mock_settings.notification_email_from = "podlog@localhost"
    mock_settings.smtp_host = "localhost"
    mock_settings.smtp_port = 25
    mock_settings.smtp_user = None
    mock_settings.smtp_password = None
    mock_settings.smtp_use_tls = False

    db = MagicMock()
    mock_session_cls.return_value = db

    # Mock system_state: never sent
    db.query.return_value.filter.return_value.first.side_effect = [
        None,  # system_state lookup returns None (never sent)
    ]

    # Mock unsent notification_log rows
    log_row = MagicMock()
    log_row.id = 1
    log_row.event_type = "episode.done"
    log_row.payload = json.dumps({
        "episode_id": "ep1",
        "episode_title": "Test Ep",
        "podcast_title": "Pod",
        "published_at": "2026-03-15T00:00:00+00:00",
        "duration_secs": 3600,
        "transcribe_duration_secs": 120.0,
        "diarize_duration_secs": 60.0,
        "total_duration_secs": 200.0,
        "queue_remaining": 0,
        "queue_estimated_secs": None,
    })
    log_row.sent = False
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [log_row]

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    mock_email.assert_called_once()


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.send_email")
@patch("app.services.digest.settings")
def test_send_digest_skips_when_not_due(mock_settings, mock_email, mock_session_cls):
    mock_settings.notification_frequency = "daily"

    db = MagicMock()
    mock_session_cls.return_value = db

    # 7am — before digest hour
    now = datetime(2026, 3, 15, 7, 0, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    mock_email.assert_not_called()
    db.close.assert_called()


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.send_email")
@patch("app.services.digest.settings")
def test_send_digest_skips_immediate_mode(mock_settings, mock_email, mock_session_cls):
    mock_settings.notification_frequency = "immediate"

    db = MagicMock()
    mock_session_cls.return_value = db

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    mock_email.assert_not_called()


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.send_email")
@patch("app.services.digest.estimate_queue_status", return_value=(0, None))
@patch("app.services.digest.settings")
def test_send_digest_skips_when_no_unsent_events(mock_settings, mock_estimate, mock_email, mock_session_cls):
    mock_settings.notification_frequency = "daily"

    db = MagicMock()
    mock_session_cls.return_value = db

    # Never sent before
    db.query.return_value.filter.return_value.first.return_value = None
    # No unsent rows
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    mock_email.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py::test_send_digest_sends_when_due -v`
Expected: FAIL — `ImportError: cannot import name 'send_digest_if_due'`

- [ ] **Step 3: Implement send_digest_if_due**

Add to `apps/pipeline/app/services/digest.py`:

```python
from app.config import settings
from app.models import NotificationLog, SystemState

LAST_DIGEST_KEY = "last_digest_sent_at"


def send_digest_if_due(now: datetime | None = None) -> None:
    """Check if a digest is due and send it if so. Called by the worker periodic task."""
    if settings.notification_frequency == "immediate":
        return

    if now is None:
        now = datetime.now(__import__("datetime").timezone.utc)

    db = SessionLocal()
    try:
        # Read last_digest_sent_at from system_state
        state_row = db.query(SystemState).filter(SystemState.key == LAST_DIGEST_KEY).first()
        last_sent = None
        if state_row:
            last_sent = datetime.fromisoformat(state_row.value)

        if not is_digest_due(settings.notification_frequency, now, last_sent):
            return

        # Query unsent events
        unsent = (
            db.query(NotificationLog)
            .filter(NotificationLog.sent == False)
            .order_by(NotificationLog.created_at)
            .all()
        )

        if not unsent:
            # Update last_sent even when empty — avoid re-checking every 15 min
            _update_last_sent(db, now)
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

        if settings.notification_frequency == "weekly":
            # Find the Monday of this week
            from datetime import timedelta
            days_since_monday = now.weekday()
            monday = now - timedelta(days=days_since_monday)
            date_label = f"Week of {monday.strftime('%b %d, %Y')}"
        else:
            date_label = now.strftime("%b %d, %Y")

        digest = DigestData(
            frequency=settings.notification_frequency,
            date_label=date_label,
            items=items,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
        )

        # Send via configured channels
        _send_digest(digest)

        # Mark all as sent
        for row in unsent:
            row.sent = True
        db.commit()

        _update_last_sent(db, now)

        logger.info(
            '"action": "digest_sent", "frequency": "%s", "items": %d',
            settings.notification_frequency, len(items),
        )
    finally:
        db.close()


def _update_last_sent(db, now: datetime) -> None:
    """Update or create the last_digest_sent_at key in system_state."""
    state_row = db.query(SystemState).filter(SystemState.key == LAST_DIGEST_KEY).first()
    if state_row:
        state_row.value = now.isoformat()
    else:
        db.add(SystemState(key=LAST_DIGEST_KEY, value=now.isoformat()))
    db.commit()


def _send_digest(digest: DigestData) -> None:
    """Send digest via all configured channels."""
    freq_label = "Daily" if digest.frequency == "daily" else "Weekly"

    if settings.email_notifications_enabled:
        html = format_digest_html(digest)
        subject = f"📋 Podlog {freq_label} Digest — {digest.date_label}"

        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        import smtplib

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.notification_email_from
        msg["To"] = settings.notification_email_to
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)

    if settings.telegram_notifications_enabled:
        import httpx
        text = format_digest_telegram(digest)
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        resp = httpx.post(url, json={
            "chat_id": settings.telegram_chat_id,
            "text": text,
            "parse_mode": "Markdown",
        })
        resp.raise_for_status()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest.py -v`
Expected: All 15 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/digest.py apps/pipeline/tests/unit/test_digest.py
git commit -m "feat(digest): add send_digest_if_due periodic task (#92)"
```

---

### Task 6: Wire Into Worker and Handler Registration

**Files:**
- Modify: `apps/pipeline/app/worker.py`
- Modify: `apps/pipeline/app/main.py`
- Test: `apps/pipeline/tests/unit/test_digest_wiring.py`

- [ ] **Step 1: Write failing tests for handler registration logic**

```python
# apps/pipeline/tests/unit/test_digest_wiring.py
"""Tests for notification handler registration based on frequency setting."""
from unittest.mock import MagicMock, patch, call

from app.services.events import EventBus
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent


def test_immediate_mode_subscribes_send_directly():
    """In immediate mode, both event types get direct send handlers."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "immediate"
        mock_settings.email_notifications_enabled = True
        mock_settings.telegram_notifications_enabled = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    # Should have handlers for both event types
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    assert len(bus._handlers[EpisodeFailedEvent]) == 1


def test_daily_mode_logs_done_sends_failed():
    """In daily mode, done events get log handler, failed events get both log and send."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "daily"
        mock_settings.email_notifications_enabled = True
        mock_settings.telegram_notifications_enabled = False
        mock_settings.notification_email_to = "user@example.com"
        mock_settings.notification_email_from = "podlog@localhost"
        mock_settings.smtp_host = "localhost"
        mock_settings.smtp_port = 25
        mock_settings.smtp_user = None
        mock_settings.smtp_password = None
        mock_settings.smtp_use_tls = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    # Done events: 1 handler (log_event)
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    # Failed events: 2 handlers (log_event + send_email)
    assert len(bus._handlers[EpisodeFailedEvent]) == 2


def test_no_handlers_when_no_channels_enabled():
    """No handlers registered if neither email nor telegram is configured."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "immediate"
        mock_settings.email_notifications_enabled = False
        mock_settings.telegram_notifications_enabled = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    assert len(bus._handlers[EpisodeDoneEvent]) == 0
    assert len(bus._handlers[EpisodeFailedEvent]) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest_wiring.py -v`
Expected: FAIL — `ImportError: cannot import name 'register_notification_handlers'`

- [ ] **Step 3: Implement register_notification_handlers**

Add to `apps/pipeline/app/services/digest.py`:

```python
from app.services.events import EventBus


def register_notification_handlers(bus: EventBus) -> None:
    """Register notification handlers on the event bus based on config.

    - immediate: send directly for both done and failed events
    - daily/weekly: log done events to DB, send failed events immediately + log them
    """
    if not settings.email_notifications_enabled and not settings.telegram_notifications_enabled:
        return

    if settings.notification_frequency == "immediate":
        # Direct send for all events
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
                send_telegram(
                    event,
                    bot_token=settings.telegram_bot_token,
                    chat_id=settings.telegram_chat_id,
                )
            bus.subscribe(EpisodeDoneEvent, _telegram_handler)
            bus.subscribe(EpisodeFailedEvent, _telegram_handler)
    else:
        # Digest mode: log done events, send+log failed events
        def _log_done(event):
            log_event(event, mark_sent=False)

        def _log_and_send_failed(event):
            log_event(event, mark_sent=True)

        bus.subscribe(EpisodeDoneEvent, _log_done)
        bus.subscribe(EpisodeFailedEvent, _log_and_send_failed)

        # Also send failed events immediately
        if settings.email_notifications_enabled:
            def _email_failed(event):
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
            bus.subscribe(EpisodeFailedEvent, _email_failed)

        if settings.telegram_notifications_enabled:
            def _telegram_failed(event):
                send_telegram(
                    event,
                    bot_token=settings.telegram_bot_token,
                    chat_id=settings.telegram_chat_id,
                )
            bus.subscribe(EpisodeFailedEvent, _telegram_failed)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_digest_wiring.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Update worker.py**

Replace the handler registration block in `apps/pipeline/app/worker.py` (lines 84-113) with:

```python
    # Register notification handlers
    from app.services.events import bus
    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)
```

Add `send_digest_if_due` to `PERIODIC_TASKS` (line 32-36). Replace the list with:

```python
PERIODIC_TASKS = [
    # (name, function_path, interval_seconds)
    ("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None),  # interval set from settings
    ("cleanup_zombie_jobs", "app.tasks.cleanup:cleanup_zombie_jobs", 30 * 60),
    ("send_digest", "app.services.digest:send_digest_if_due", 15 * 60),
]
```

- [ ] **Step 6: Update main.py**

Replace the handler registration block in `apps/pipeline/app/main.py` (lines 8-46) with:

```python
from app.api import feeds, episodes, queue, health, embed
from app.services.events import bus
from app.services.digest import register_notification_handlers

register_notification_handlers(bus)
```

Remove the now-unused imports: `settings`, `EpisodeDoneEvent`, `EpisodeFailedEvent`, `send_email`, `send_telegram`.

- [ ] **Step 7: Run full test suite**

Run: `cd apps/pipeline && python -m pytest tests/unit/ -v`
Expected: All tests PASS (existing + new, minus the 3 pre-existing failures in test_inference and test_retry)

- [ ] **Step 8: Commit**

```bash
git add apps/pipeline/app/services/digest.py apps/pipeline/app/worker.py apps/pipeline/app/main.py apps/pipeline/tests/unit/test_digest_wiring.py
git commit -m "feat(digest): wire handler registration and periodic task (#92)"
```
