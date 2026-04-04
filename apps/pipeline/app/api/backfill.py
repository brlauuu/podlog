"""Backfill API endpoint for one-time data migrations."""
import logging
from threading import Lock, Thread

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["backfill"])

_lock = Lock()
_running = False


@router.post("/backfill/chunks")
async def backfill_chunks_endpoint(embed: bool = True) -> dict:
    """Trigger chunk backfill for all done episodes.

    Runs in a background thread to avoid blocking the API.
    Idempotent — safe to call multiple times.
    """
    global _running
    with _lock:
        if _running:
            return {"status": "already_running"}
        _running = True

    def _run() -> None:
        global _running
        try:
            from app.tasks.backfill_chunks import backfill_chunks

            backfill_chunks(embed=embed)
        except Exception:
            logger.exception('"action": "backfill_chunks_api_error"')
        finally:
            with _lock:
                _running = False

    Thread(target=_run, daemon=True).start()
    return {"status": "started", "embed": embed}
