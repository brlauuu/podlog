"""Alerts for a pipeline that keeps failing or has stopped moving (#1099).

Per-episode failure notices say that one episode failed. They cannot say
that every episode is failing: from 2026-10-20 to 2026-10-28 each
transcription hit a retired Fireworks endpoint, retried as a transient
error and failed quietly, and nothing compared that to "nothing has
finished in a week". This module adds the two checks that would have:

- **Failure streak:** a stage has failed ``pipeline_alert_failure_streak``
  jobs in a row since its last success. Retries count, since each attempt
  is its own failed job_queue row.
- **Stall:** jobs have waited longer than ``pipeline_alert_stall_hours``
  and no job has finished in that time. An empty queue never stalls.

Each sends one alert, and one "recovered" notice once a job succeeds
again. What has already been sent lives in system_state so the
15-minute periodic run does not repeat itself.

job_queue rows record when a job was picked, not when it finished, so
"last progress" is the picked_at of the newest done job.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState
from app.services.notification_events import PipelineAlertEvent

logger = logging.getLogger(__name__)

STATE_KEY = "pipeline_alerts"
_ERROR_PREVIEW_CHARS = 300

_LAST_DONE_SQL = text(
    "SELECT task, max(id) FROM job_queue WHERE status = 'done' GROUP BY task"
)

# Failed jobs per stage since that stage's last done job, with the newest one.
_STREAKS_SQL = text("""
    WITH last_done AS (
        SELECT task, max(id) AS id FROM job_queue WHERE status = 'done' GROUP BY task
    )
    SELECT j.task,
           count(*) AS failures,
           min(j.created_at) AS since,
           max(j.id) AS last_failed_id,
           (array_agg(j.error ORDER BY j.id DESC))[1] AS last_error,
           (array_agg(e.error_class ORDER BY j.id DESC))[1] AS error_class
    FROM job_queue j
    LEFT JOIN last_done d ON d.task = j.task
    LEFT JOIN episodes e ON e.id = j.episode_id
    WHERE j.status = 'failed' AND j.id > COALESCE(d.id, 0)
    GROUP BY j.task
""")

# An in-flight job is 'picked' (job_queue.py); there is no 'running' status.
_QUEUE_SQL = text("""
    SELECT
        (SELECT count(*) FROM job_queue WHERE status IN ('pending', 'picked')) AS waiting,
        (SELECT min(created_at) FROM job_queue
          WHERE status IN ('pending', 'picked')) AS oldest_waiting,
        (SELECT max(picked_at) FROM job_queue WHERE status = 'done') AS last_progress
""")


@dataclass
class Streak:
    task: str
    failures: int
    since: datetime | None
    last_failed_id: int
    last_error: str | None
    error_class: str | None


@dataclass
class QueueState:
    waiting: int
    oldest_waiting: datetime | None
    last_progress: datetime | None


def _fmt_age(delta: timedelta) -> str:
    hours = int(delta.total_seconds() // 3600)
    if hours >= 48:
        return f"{hours // 24} days"
    if hours >= 1:
        return f"{hours} h"
    return f"{int(delta.total_seconds() // 60)} min"


def _fmt_ts(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "never"


def _preview(error: str | None) -> str:
    if not error:
        return "(no error text)"
    error = " ".join(error.split())
    if len(error) > _ERROR_PREVIEW_CHARS:
        return error[:_ERROR_PREVIEW_CHARS] + "…"
    return error


def _parse_ts(raw: str | None) -> datetime | None:
    return datetime.fromisoformat(raw) if raw else None


def evaluate(
    state: dict,
    streaks: dict[str, Streak],
    last_done: dict[str, int],
    queue: QueueState,
    now: datetime,
    streak_threshold: int,
    stall_hours: int,
) -> tuple[dict, list[PipelineAlertEvent]]:
    """Decide which alerts to send. Pure: no DB, no I/O.

    Returns the new state and the events to emit. The state maps
    ``streaks`` → {task: {"last_failed_id": int}} and ``stall`` →
    {"last_progress": iso | None} for alerts already sent.
    """
    alerted_streaks: dict = dict(state.get("streaks") or {})
    alerted_stall: dict | None = state.get("stall")
    events: list[PipelineAlertEvent] = []

    # Recoveries first, so a stage that recovered and broke again in one
    # interval is reported in that order.
    for task, info in list(alerted_streaks.items()):
        if last_done.get(task, 0) > info["last_failed_id"]:
            del alerted_streaks[task]
            events.append(PipelineAlertEvent(
                kind="failure_streak",
                stage=task,
                recovered=True,
                headline=f"{task}: recovered",
                details=[("Stage", task), ("Status", "a job succeeded again")],
            ))
        elif task not in streaks:
            # The failed rows are gone without a success (episodes deleted):
            # nothing to report either way, so re-arm quietly.
            del alerted_streaks[task]

    if streak_threshold > 0:
        for task, streak in sorted(streaks.items()):
            if streak.failures < streak_threshold or task in alerted_streaks:
                continue
            alerted_streaks[task] = {"last_failed_id": streak.last_failed_id}
            label = streak.error_class or "unclassified"
            events.append(PipelineAlertEvent(
                kind="failure_streak",
                stage=task,
                headline=f"{task}: {streak.failures} consecutive failures ({label})",
                details=[
                    ("Stage", task),
                    ("Failures in a row", str(streak.failures)),
                    ("Failing since", _fmt_ts(streak.since)),
                    ("Error class", label),
                    ("Last error", _preview(streak.last_error)),
                ],
            ))
    else:
        alerted_streaks = {}

    stalled = False
    if stall_hours > 0 and queue.waiting > 0 and queue.oldest_waiting is not None:
        cutoff = now - timedelta(hours=stall_hours)
        stalled = queue.oldest_waiting < cutoff and (
            queue.last_progress is None or queue.last_progress < cutoff
        )

    if stalled and alerted_stall is None:
        alerted_stall = {
            "last_progress": queue.last_progress.isoformat() if queue.last_progress else None,
        }
        since = queue.last_progress or queue.oldest_waiting
        events.append(PipelineAlertEvent(
            kind="stall",
            headline=f"Queue stalled: nothing finished in {_fmt_age(now - since)}",
            details=[
                ("Jobs waiting", str(queue.waiting)),
                ("Oldest waiting since", _fmt_ts(queue.oldest_waiting)),
                ("Last job finished", _fmt_ts(queue.last_progress)),
            ],
        ))
    elif not stalled and alerted_stall is not None:
        before = _parse_ts(alerted_stall.get("last_progress"))
        moved = queue.last_progress is not None and (before is None or queue.last_progress > before)
        if moved:
            events.append(PipelineAlertEvent(
                kind="stall",
                recovered=True,
                headline="Queue moving again",
                details=[("Last job finished", _fmt_ts(queue.last_progress))],
            ))
        alerted_stall = None

    # Only non-empty keys, so a run with nothing to remember leaves the
    # state equal to {} and an idle install never writes the row.
    new_state: dict = {}
    if alerted_streaks:
        new_state["streaks"] = alerted_streaks
    if alerted_stall is not None:
        new_state["stall"] = alerted_stall
    return new_state, events


def _load_state(db: Session) -> tuple[SystemState | None, dict]:
    row = db.query(SystemState).filter(SystemState.key == STATE_KEY).first()
    if row is None:
        return None, {}
    try:
        return row, json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning('"action": "pipeline_alerts_state_unreadable", "value": "%s"', row.value)
        return row, {}


def _read_streaks(db: Session) -> dict[str, Streak]:
    return {
        r.task: Streak(
            task=r.task,
            failures=int(r.failures),
            since=r.since,
            last_failed_id=int(r.last_failed_id),
            last_error=r.last_error,
            error_class=r.error_class,
        )
        for r in db.execute(_STREAKS_SQL)
    }


def _read_queue(db: Session) -> QueueState:
    r = db.execute(_QUEUE_SQL).one()
    return QueueState(
        waiting=int(r.waiting), oldest_waiting=r.oldest_waiting, last_progress=r.last_progress,
    )


def check_pipeline_alerts(now: datetime | None = None) -> list[PipelineAlertEvent]:
    """Periodic entry point: evaluate, persist what was sent, emit events."""
    from app.database import SessionLocal
    from app.services.events import bus

    if now is None:
        now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        row, state = _load_state(db)
        last_done = {task: int(job_id) for task, job_id in db.execute(_LAST_DONE_SQL)}
        new_state, events = evaluate(
            state,
            _read_streaks(db),
            last_done,
            _read_queue(db),
            now,
            settings.pipeline_alert_failure_streak,
            settings.pipeline_alert_stall_hours,
        )
        if new_state != state:
            value = json.dumps(new_state)
            if row is None:
                db.add(SystemState(key=STATE_KEY, value=value))
            else:
                row.value = value
            db.commit()
    finally:
        db.close()

    # Emit after the commit: a delivery failure must not re-send next run.
    for event in events:
        logger.warning(
            '"action": "pipeline_alert", "kind": "%s", "stage": "%s", '
            '"recovered": %s, "headline": "%s"',
            event.kind, event.stage or "", str(event.recovered).lower(), event.headline,
        )
        bus.emit(event)
    return events
