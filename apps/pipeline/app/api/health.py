"""
GET /api/health

Returns worker warm-up state. The queue dashboard polls this to show the
"Worker initializing" banner (PRD-02 §5.6).

States:
  WARMING_UP  — prewarm.py is still running (models downloading)
  OK          — worker is ready to process jobs
  DEGRADED    — worker unreachable (no heartbeat in Redis)
"""
import json
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# The prewarm task writes this key to Redis when it finishes.
PREWARM_DONE_KEY = "podlog:prewarm:done"


class HealthResponse(BaseModel):
    status: str  # WARMING_UP | OK | DEGRADED


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    try:
        import redis

        r = redis.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        prewarm_done = r.get(PREWARM_DONE_KEY)
        if prewarm_done:
            return HealthResponse(status="OK")
        return HealthResponse(status="WARMING_UP")
    except Exception as exc:
        logger.warning("Health check failed: %s", exc)
        return HealthResponse(status="DEGRADED")
