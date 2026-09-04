"""Queue dashboard snapshot (#555, #1034).

Lives in the service layer so both the HTTP route (`app/api/queue.py`) and
the Telegram bot (`app/services/telegram_bot.py`) can read the queue without
the bot depending on the API package.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

# Map job_queue.task -> UI display status for active jobs.
#
# Must cover every key in task_registry.TASK_REGISTRY. An unmapped task falls
# through to the raw task name below, which is not a status any episode row
# ever holds -- `chunk` was missing here and surfaced as status "chunk" while
# the DB stored "chunking", so the API and the database disagreed about the
# name of the same state (#968). Guarded by
# tests/unit/test_queue_api.py::TestTaskToStatusMap, which derives the
# expected key set from TASK_REGISTRY rather than restating it, and by
# apps/web/tests/unit/queue-stage-parity.test.ts, which parses this file by
# path -- keep the `TASK_TO_STATUS: dict[str, str] = {` literal intact.
TASK_TO_STATUS: dict[str, str] = {
    "download": "downloading",
    "transcribe": "transcribing",
    "diarize": "diarizing",
    "chunk": "chunking",
    "embed": "embedding",
    "infer": "inferring",
    "archive": "archiving",
}


def _rows(db: Session, sql: str) -> list[dict]:
    """Run a read-only SQL statement and return rows as dicts."""
    return [dict(row._mapping) for row in db.execute(text(sql)).all()]


def queue_snapshot(db: Session) -> dict:
    """Return the queue dashboard snapshot consumed by the web UI and the bot.

    Shape is the contract that `apps/web/src/components/QueueStatus.tsx`
    and its view-model helper depend on -- do not change keys without
    coordinating a web-side update.
    """
    active_rows = _rows(
        db,
        """
        SELECT DISTINCT ON (e.id)
          e.id        AS episode_id,
          e.title,
          jq.task     AS active_task,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          jq.picked_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM job_queue jq
        JOIN episodes e ON e.id = jq.episode_id
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE jq.status = 'picked'
        ORDER BY e.id, jq.picked_at DESC
        """,
    )
    pending_rows = _rows(
        db,
        """
        SELECT DISTINCT ON (e.id)
          e.id        AS episode_id,
          e.title,
          jq.task     AS pending_task,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM job_queue jq
        JOIN episodes e ON e.id = jq.episode_id
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE jq.status = 'pending'
          AND e.status NOT IN ('done', 'failed', 'no_speech')
          AND NOT EXISTS (
            SELECT 1 FROM job_queue jq2
            WHERE jq2.episode_id = e.id AND jq2.status = 'picked'
          )
        ORDER BY e.id, jq.created_at ASC
        """,
    )
    failed_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status = 'failed'
        ORDER BY e.updated_at DESC
        """,
    )
    # #968: no_speech rides in the done bucket. It is terminal and not a
    # failure -- nothing malfunctioned, the audio simply had no speech (#955)
    # -- but every bucket here excluded it, so those episodes were invisible
    # on the dashboard entirely. Rows carry e.status, so the UI distinguishes
    # them by badge without needing a separate bucket.
    done_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status IN ('done', 'no_speech')
        ORDER BY e.updated_at DESC
        LIMIT 50
        """,
    )
    stuck_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status NOT IN ('done', 'failed', 'no_speech')
          AND NOT EXISTS (
            SELECT 1 FROM job_queue jq
            WHERE jq.episode_id = e.id AND jq.status IN ('pending', 'picked')
          )
        ORDER BY e.updated_at DESC
        """,
    )
    done_count = db.execute(
        text("SELECT COUNT(*) AS count FROM episodes WHERE status IN ('done', 'no_speech')")
    ).scalar_one()

    for row in active_rows:
        row["status"] = TASK_TO_STATUS.get(row.get("active_task"), row.get("active_task"))
    for row in pending_rows:
        row["status"] = "pending"
    for row in stuck_rows:
        row["status"] = "stuck"

    return {
        "active_count": len(active_rows),
        "pending_count": len(pending_rows),
        "failed_count": len(failed_rows),
        "done_count": int(done_count or 0),
        "stuck_count": len(stuck_rows),
        "active_jobs": active_rows,
        "pending_jobs": pending_rows,
        "failed_jobs": failed_rows,
        "done_jobs": done_rows,
        "stuck_jobs": stuck_rows,
    }


