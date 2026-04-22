"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.
"""
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Episode, Feed, SystemState

logger = logging.getLogger(__name__)

STALE_KEY = "meta_analysis_stale"


def is_stale(db: Session) -> bool:
    row = db.query(SystemState).filter(SystemState.key == STALE_KEY).one_or_none()
    return row is not None and row.value == "true"


def set_stale(db: Session) -> None:
    stmt = insert(SystemState).values(key=STALE_KEY, value="true")
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": "true"}
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


def _per_feed(db: Session) -> list[dict[str, Any]]:
    """Per-feed aggregates over done episodes only."""
    rows = db.execute(
        select(
            Feed.id.label("feed_id"),
            Feed.title,
            func.count(Episode.id).label("episode_count"),
            func.avg(Episode.duration_secs).label("avg_secs"),
            func.stddev_samp(Episode.duration_secs).label("std_secs"),
            func.coalesce(
                func.sum(Episode.fireworks_stt_cost_usd), 0.0
            ).label("total_cost_usd"),
            func.coalesce(
                func.sum(Episode.fireworks_audio_minutes), 0.0
            ).label("total_audio_minutes"),
        )
        .join(Episode, Episode.feed_id == Feed.id)
        .where(Episode.status == "done")
        .group_by(Feed.id, Feed.title)
    ).all()

    return [
        {
            "feed_id": r.feed_id,
            "title": r.title or "(untitled)",
            "episode_count": r.episode_count,
            "avg_length_min": round(float(r.avg_secs or 0) / 60.0, 2),
            "std_length_min": round(float(r.std_secs or 0) / 60.0, 2),
            "total_cost_usd": round(float(r.total_cost_usd or 0), 4),
            "total_audio_minutes": round(float(r.total_audio_minutes or 0), 2),
            # Remaining fields filled in by later tasks; stub now to keep
            # the JSON shape stable.
            "total_words": 0,
            "total_tokens_segments": 0,
            "total_tokens_chunks": 0,
            "inferred_host_name": None,
        }
        for r in rows
    ]


def compute_snapshot(db: Session) -> dict[str, Any]:
    """Compute the full meta-analysis snapshot dict."""
    return {
        "per_feed": _per_feed(db),
        "per_episode": [],
        "per_speaker": [],
        "timeline_monthly": [],
        "coverage": {},
    }
