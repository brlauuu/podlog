"""
GET /api/health

Returns per-service status for the system dashboard.

States per service:
  OK          -- service is reachable and healthy
  WARMING_UP  -- worker is still loading models
  DEGRADED    -- service unreachable or unhealthy
"""
import logging

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.database import SessionLocal
from app.models import SystemState

logger = logging.getLogger(__name__)
router = APIRouter()


class ServiceStatus(BaseModel):
    name: str
    status: str  # OK | WARMING_UP | DEGRADED


class HealthResponse(BaseModel):
    status: str  # overall: OK | WARMING_UP | DEGRADED
    services: list[ServiceStatus]


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    services: list[ServiceStatus] = []

    # Database + Worker (both need a DB session)
    db = None
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        services.append(ServiceStatus(name="Database", status="OK"))

        # Worker (via prewarm flag in DB — shared across containers)
        row = db.query(SystemState).filter(SystemState.key == "prewarm_done").first()
        if row is not None and row.value == "1":
            services.append(ServiceStatus(name="Worker", status="OK"))
        else:
            services.append(ServiceStatus(name="Worker", status="WARMING_UP"))
    except Exception as exc:
        logger.warning("Health check -- database failed: %s", exc)
        if not any(s.name == "Database" for s in services):
            services.append(ServiceStatus(name="Database", status="DEGRADED"))
        if not any(s.name == "Worker" for s in services):
            services.append(ServiceStatus(name="Worker", status="WARMING_UP"))
    finally:
        if db is not None:
            db.close()

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
