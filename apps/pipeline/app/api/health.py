"""
GET /api/health

Returns per-service status for the system dashboard.

States per service:
  OK          -- service is reachable and healthy
  WARMING_UP  -- worker is still loading models
  DEGRADED    -- service unreachable or unhealthy
"""
import logging
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.database import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()

# The prewarm script writes this file when it finishes.
PREWARM_FLAG_FILE = "/tmp/podlog_prewarm_done"


class ServiceStatus(BaseModel):
    name: str
    status: str  # OK | WARMING_UP | DEGRADED


class HealthResponse(BaseModel):
    status: str  # overall: OK | WARMING_UP | DEGRADED
    services: list[ServiceStatus]


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    services: list[ServiceStatus] = []

    # Database
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        services.append(ServiceStatus(name="Database", status="OK"))
    except Exception as exc:
        logger.warning("Health check -- database failed: %s", exc)
        services.append(ServiceStatus(name="Database", status="DEGRADED"))

    # Worker (via prewarm flag file)
    if Path(PREWARM_FLAG_FILE).exists():
        services.append(ServiceStatus(name="Worker", status="OK"))
    else:
        services.append(ServiceStatus(name="Worker", status="WARMING_UP"))

    # Pipeline API is implicitly OK if this endpoint responds
    services.append(ServiceStatus(name="Pipeline API", status="OK"))

    # Overall status
    statuses = [s.status for s in services]
    if all(s == "OK" for s in statuses):
        overall = "OK"
    elif "DEGRADED" in statuses:
        overall = "DEGRADED"
    else:
        overall = "WARMING_UP"

    return HealthResponse(status=overall, services=services)
