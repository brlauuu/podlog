"""Rebuilds materialized speaker turns for an episode (#942).

Thin wrapper over the ``rebuild_speaker_turns(uuid)`` SQL function created in
migration 021. The turn-boundary logic deliberately lives in the database
rather than here: the speaker-merge route in the web app has to rebuild turns
too, and a second copy of that SQL in TypeScript is exactly the cross-runtime
divergence CLAUDE.md warns about. Both runtimes call the one function.
"""

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def rebuild_speaker_turns(db: Session, episode_id: str) -> int:
    """Rebuild one episode's turns. Returns the number of turns written."""
    count = db.execute(
        text("SELECT rebuild_speaker_turns(CAST(:eid AS uuid))"), {"eid": episode_id}
    ).scalar_one()
    db.commit()
    logger.info(
        '"action": "speaker_turns_rebuilt", "episode_id": "%s", "turns": %d',
        episode_id,
        count,
    )
    return int(count)


def rebuild_missing_speaker_turns(db: Session, limit: int = 50) -> int:
    """Rebuild episodes that have segments but no turns. Returns how many.

    The safety net for the failure mode this project keeps hitting: a future
    writer of ``segments.speaker_label`` that forgets to rebuild. It only
    catches *missing* turns, not stale ones — detecting staleness would need a
    watermark per episode, and missing is the case a forgotten call actually
    produces for new episodes.
    """
    rows = db.execute(
        text(
            """
            SELECT DISTINCT s.episode_id
            FROM segments s
            WHERE NOT EXISTS (
              SELECT 1 FROM speaker_turns t WHERE t.episode_id = s.episode_id
            )
            LIMIT :lim
            """
        ),
        {"lim": limit},
    ).scalars().all()

    for episode_id in rows:
        rebuild_speaker_turns(db, str(episode_id))

    if rows:
        logger.warning(
            '"action": "speaker_turns_reconciled", "episodes": %d', len(rows)
        )
    return len(rows)
