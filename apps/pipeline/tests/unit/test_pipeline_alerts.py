"""Unit tests for pipeline alerts (#1099): decisions, formatting, wiring.

The SQL and the end-to-end "exactly one notification" behaviour are covered
against a real database in tests/integration/test_pipeline_alerts.py.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.events import EventBus
from app.services.notification_events import PipelineAlertEvent
from app.services.notifications import format_alert_html, format_alert_telegram
from app.services.pipeline_alerts import QueueState, Streak, evaluate

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
IDLE = QueueState(waiting=0, oldest_waiting=None, last_progress=None)


def _streak(task="transcribe", failures=5, last_failed_id=10, error="boom", cls="OOM"):
    return Streak(task=task, failures=failures, since=NOW - timedelta(hours=3),
                  last_failed_id=last_failed_id, last_error=error, error_class=cls)


def _eval(state=None, streaks=None, last_done=None, queue=IDLE, streak=5, stall=24):
    return evaluate(state or {}, streaks or {}, last_done or {}, queue, NOW, streak, stall)


def test_streak_names_stage_class_and_last_error():
    state, events = _eval(streaks={"transcribe": _streak(error="HTTP 503 no healthy upstream",
                                                         cls="TRANSIENT_NETWORK")})
    assert state == {"streaks": {"transcribe": {"last_failed_id": 10}}}
    assert [e.headline for e in events] == [
        "transcribe: 5 consecutive failures (TRANSIENT_NETWORK)"
    ]
    assert ("Last error", "HTTP 503 no healthy upstream") in events[0].details


def test_unclassified_and_long_errors_are_readable():
    _, events = _eval(streaks={"embed": _streak(task="embed", cls=None, error="x " * 400)})
    assert events[0].headline.endswith("(unclassified)")
    last_error = dict(events[0].details)["Last error"]
    assert len(last_error) == 301 and last_error.endswith("…")


def test_streak_rows_deleted_without_success_rearm_quietly():
    """Episodes deleted mid-streak: no false "recovered" message."""
    state, events = _eval(state={"streaks": {"transcribe": {"last_failed_id": 10}}})
    assert events == [] and state == {}


def test_recovery_needs_a_success_newer_than_the_alert():
    alerted = {"streaks": {"transcribe": {"last_failed_id": 10}}}
    _, events = _eval(state=alerted, streaks={"transcribe": _streak(failures=2)},
                      last_done={"transcribe": 9})
    assert events == []
    state, events = _eval(state=alerted, last_done={"transcribe": 11})
    assert [e.recovered for e in events] == [True] and state == {}


def test_stall_queue_drained_without_progress_clears_quietly():
    """Someone deleted the stuck jobs: the stall is over, but nothing moved."""
    before = (NOW - timedelta(days=3)).isoformat()
    state, events = _eval(state={"stall": {"last_progress": before}},
                          queue=QueueState(0, None, NOW - timedelta(days=3)))
    assert events == [] and state == {}


def test_stall_with_no_job_ever_finished():
    queue = QueueState(waiting=3, oldest_waiting=NOW - timedelta(hours=30), last_progress=None)
    state, events = _eval(queue=queue)
    assert state == {"stall": {"last_progress": None}}
    assert events[0].headline == "Queue stalled: nothing finished in 30 h"
    assert ("Last job finished", "never") in events[0].details


def test_telegram_text_survives_markdown_in_errors():
    event = PipelineAlertEvent(
        kind="failure_streak", stage="infer", headline="infer: 5 consecutive failures (OOM)",
        details=[("Last error", "No module named `spacy_trf` in *site_packages*")],
    )
    text = format_alert_telegram(event)
    assert text.startswith("*⚠️ Stage keeps failing*")
    assert "*Last error:* `No module named 'spacy_trf' in *site_packages*`" in text
    # Code spans balance, so Telegram's legacy Markdown parser accepts it.
    assert text.count("`") % 2 == 0


def test_html_escapes_error_text():
    event = PipelineAlertEvent(kind="stall", recovered=True, headline="Queue <moving> again",
                               details=[("Last error", "<script>alert(1)</script>")])
    html = format_alert_html(event)
    assert "Pipeline recovered" in html
    assert "&lt;script&gt;" in html and "<script>" not in html
    assert "Queue &lt;moving&gt; again" in html


def test_alert_is_sent_immediately_even_with_daily_digest():
    from app.services.digest import register_notification_handlers

    bus = EventBus()
    register_notification_handlers(bus)
    ns = {"notification_frequency": "daily", "telegram_configured": True,
          "telegram_bot_token": "t", "telegram_chat_id": "c", "email_configured": False}
    event = PipelineAlertEvent(kind="stall", headline="Queue stalled")
    with patch("app.services.digest.get_notification_settings", return_value=ns), \
         patch("app.services.digest.SessionLocal"), \
         patch("app.services.digest.send_telegram") as mock_tg, \
         patch("app.services.digest.log_event") as mock_log:
        bus.emit(event)
    mock_tg.assert_called_once_with(event, bot_token="t", chat_id="c")
    mock_log.assert_not_called()


def test_registered_as_a_periodic_task():
    from app.task_registry import PERIODIC_TASKS

    task = next(t for t in PERIODIC_TASKS if t.name == "check_pipeline_alerts")
    assert task.target == "app.services.pipeline_alerts:check_pipeline_alerts"
    assert task.get_interval() == 15 * 60
