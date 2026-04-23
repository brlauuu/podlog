"""Meta-analysis dashboard API (Issue #521)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import MetaAnalysisSnapshot
from app.services.meta_analysis import is_stale, recompute_and_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _serialize(row: MetaAnalysisSnapshot | None, stale: bool) -> dict:
    if row is None:
        return {
            "snapshot": None,
            "computed_at": None,
            "episode_count": 0,
            "feed_count": 0,
            "is_stale": stale,
            "last_error": None,
        }
    return {
        "snapshot": row.snapshot,
        "computed_at": row.computed_at.isoformat() if row.computed_at else None,
        "episode_count": row.episode_count,
        "feed_count": row.feed_count,
        "is_stale": stale,
        "last_error": None,
    }


@router.get("/meta-analysis/snapshot")
def get_snapshot(db: Session = Depends(get_db)) -> dict:
    row = (
        db.query(MetaAnalysisSnapshot)
        .filter(MetaAnalysisSnapshot.id == 1)
        .one_or_none()
    )
    if row is None:
        return _serialize(None, stale=True)
    return _serialize(row, stale=is_stale(db))


@router.post("/meta-analysis/refresh")
def post_refresh(db: Session = Depends(get_db)) -> dict:
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('meta_analysis_refresh'))")
    )
    try:
        row = recompute_and_store(db)
    except Exception:
        logger.exception('"action": "meta_analysis_refresh_failed"')
        raise HTTPException(status_code=500, detail="Recompute failed")
    return _serialize(row, stale=False)


@router.get("/meta-analysis/coverage/missing-speakers")
def missing_speakers(db: Session = Depends(get_db)) -> dict:
    row = (
        db.query(MetaAnalysisSnapshot)
        .filter(MetaAnalysisSnapshot.id == 1)
        .one_or_none()
    )
    if row is None:
        return {"podcasts": []}
    excluded = (
        row.snapshot.get("coverage", {}).get("host_share", {}).get("excluded", [])
    )
    grouped: dict[str, dict] = {}
    for e in excluded:
        g = grouped.setdefault(
            e["feed_id"],
            {
                "feed_id": e["feed_id"],
                "title": e["feed_title"],
                "episodes": [],
            },
        )
        g["episodes"].append(
            {
                "id": e["episode_id"],
                "title": e["title"],
                "reason": e["reason"],
            }
        )
    return {"podcasts": list(grouped.values())}
