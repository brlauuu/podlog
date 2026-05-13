"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.

The per-feed / per-episode / per-speaker / timeline / coverage builders
live in `meta_analysis_aggregations.py` (split out in #662 to keep this
module under the 300-line house style). They are re-exported below so
existing imports — including `svc._count_turns` and friends in the test
suite — keep working unchanged.
"""
import logging
import uuid
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import MetaAnalysisSnapshot, SystemState
from app.services.meta_analysis_aggregations import (
    _TOKENIZER_AVAILABLE,
    _count_tokens,
    _count_turns,
    _coverage_and_host_share,
    _host_speaker_label_for_episode,
    _identify_feed_host,
    _per_episode,
    _per_feed,
    _per_speaker,
    _roll_up_feed_text_totals,
    _timeline_monthly,
)

logger = logging.getLogger(__name__)

STALE_KEY = "meta_analysis_stale"


__all__ = [
    "STALE_KEY",
    "is_stale",
    "set_stale",
    "clear_stale",
    "compute_snapshot",
    "upsert_snapshot",
    "recompute_and_store",
    # Re-exported from meta_analysis_aggregations for callers and tests.
    "_TOKENIZER_AVAILABLE",
    "_count_tokens",
    "_count_turns",
    "_coverage_and_host_share",
    "_host_speaker_label_for_episode",
    "_identify_feed_host",
    "_per_episode",
    "_per_feed",
    "_per_speaker",
    "_roll_up_feed_text_totals",
    "_timeline_monthly",
]


def is_stale(db: Session) -> bool:
    row = db.query(SystemState).filter(SystemState.key == STALE_KEY).one_or_none()
    return row is not None and row.value != "false"


def set_stale(db: Session) -> None:
    # Each call writes a fresh UUID token so recompute_and_store can detect
    # concurrent set_stale during compute and skip its conditional clear.
    token = str(uuid.uuid4())
    stmt = insert(SystemState).values(key=STALE_KEY, value=token)
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": token}
    )
    db.execute(stmt)
    db.commit()


def clear_stale(db: Session) -> None:
    stmt = insert(SystemState).values(key=STALE_KEY, value="false")
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": "false"}
    )
    db.execute(stmt)
    db.commit()


def _capture_stale_token(db: Session) -> str | None:
    """Read the current stale token, or None if not stale."""
    row = db.query(SystemState).filter(SystemState.key == STALE_KEY).one_or_none()
    if row is None or row.value == "false":
        return None
    return row.value


def _clear_stale_if_token(db: Session, token: str | None) -> bool:
    """Clear the stale flag only if its value still equals `token`.

    Returns True if cleared, False if a concurrent set_stale rotated the
    token during compute (flag stays stale so the next idle tick recomputes).
    """
    if token is None:
        return False
    affected = (
        db.query(SystemState)
        .filter(SystemState.key == STALE_KEY, SystemState.value == token)
        .update({"value": "false"}, synchronize_session=False)
    )
    db.commit()
    return affected > 0


def compute_snapshot(db: Session) -> dict[str, Any]:
    """Compute the full meta-analysis snapshot dict."""
    per_ep = _per_episode(db)
    per_feed = _per_feed(db)
    _roll_up_feed_text_totals(per_feed, per_ep)
    coverage = _coverage_and_host_share(db, per_ep, per_feed)
    return {
        "per_feed": per_feed,
        "per_episode": per_ep,
        "per_speaker": _per_speaker(db),
        "timeline_monthly": _timeline_monthly(db, per_ep),
        "coverage": coverage,
    }


def upsert_snapshot(
    db: Session,
    snapshot: dict[str, Any],
    episode_count: int,
    feed_count: int,
) -> MetaAnalysisSnapshot:
    """UPSERT into the single-row snapshot table."""
    from datetime import datetime, timezone

    stmt = insert(MetaAnalysisSnapshot).values(
        id=1,
        snapshot=snapshot,
        computed_at=datetime.now(timezone.utc),
        episode_count=episode_count,
        feed_count=feed_count,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "snapshot": stmt.excluded.snapshot,
            "computed_at": stmt.excluded.computed_at,
            "episode_count": stmt.excluded.episode_count,
            "feed_count": stmt.excluded.feed_count,
        },
    )
    db.execute(stmt)
    db.commit()
    return db.query(MetaAnalysisSnapshot).filter(MetaAnalysisSnapshot.id == 1).one()


def recompute_and_store(db: Session) -> MetaAnalysisSnapshot:
    """Run compute_snapshot, upsert, and conditionally clear the stale flag.

    Captures the stale token *before* compute, then only clears if the token
    is unchanged afterward. If a speaker rename (or any writer) called
    set_stale during compute, the token rotated — we leave the flag stale so
    the next idle tick recomputes against the newer data. Prevents the silent
    signal drop that the unconditional clear caused.
    """
    token = _capture_stale_token(db)
    snap = compute_snapshot(db)
    episode_count = len(snap["per_episode"])
    feed_count = len(snap["per_feed"])
    row = upsert_snapshot(db, snap, episode_count, feed_count)
    _clear_stale_if_token(db, token)
    return row
