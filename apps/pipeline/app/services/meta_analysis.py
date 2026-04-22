"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.
"""
import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import SystemState

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
