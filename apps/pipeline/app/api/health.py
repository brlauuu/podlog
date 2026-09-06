"""
GET /api/health

Returns per-service status for the system dashboard.

States per service:
  OK          -- service is reachable and healthy
  WARMING_UP  -- worker is still loading models
  DEGRADED    -- service unreachable or unhealthy
"""
import logging

import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models import SystemState
from app.services.notification_settings import get_runtime_inference_settings
from app.services.preflight import diarization_preflight

logger = logging.getLogger(__name__)
router = APIRouter()


class ServiceStatus(BaseModel):
    name: str
    status: str  # OK | WARMING_UP | DEGRADED
    # #1048: a human-readable reason, so far only for the Diarization
    # pre-flight. Optional and additive; older consumers ignore it.
    detail: str | None = None


class HealthResponse(BaseModel):
    status: str  # overall: OK | WARMING_UP | DEGRADED
    services: list[ServiceStatus]


def _diarization_service() -> ServiceStatus:
    try:
        result = diarization_preflight()
    except Exception as exc:  # the check must never take the endpoint down
        logger.warning('"action": "diarization_preflight_error", "error": "%s"', exc)
        return ServiceStatus(name="Diarization", status="OK", detail="pre-flight check errored")
    status = "DEGRADED" if result.status == "FAILED" else "OK"
    return ServiceStatus(name="Diarization", status=status, detail=result.detail)


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    services: list[ServiceStatus] = []
    provider = settings.inference_provider

    # Database + Worker (both need a DB session)
    db = None
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        services.append(ServiceStatus(name="Database", status="OK"))
        try:
            runtime = get_runtime_inference_settings(db)
            runtime_provider = runtime.get("inference_provider")
            if runtime_provider in ("local", "fireworks"):
                provider = runtime_provider
        except Exception:
            # Fallback to env-backed default when runtime settings row is malformed.
            pass

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

    # Ollama (optional when Fireworks provider mode is enabled)
    if provider == "fireworks":
        services.append(ServiceStatus(name="Ollama", status="OK"))
    else:
        try:
            resp = httpx.get(f"{settings.ollama_url}/", timeout=3)
            if resp.status_code == 200:
                services.append(ServiceStatus(name="Ollama", status="OK"))
            else:
                services.append(ServiceStatus(name="Ollama", status="DEGRADED"))
        except Exception:
            services.append(ServiceStatus(name="Ollama", status="DEGRADED"))

    # Pipeline API is implicitly OK if this endpoint responds
    services.append(ServiceStatus(name="Pipeline API", status="OK"))

    # Diarization pre-flight (#1048): can the configured token download the
    # gated pyannote model? FAILED is the only state that degrades health;
    # SKIPPED (cloud provider) and UNKNOWN (HuggingFace unreachable) report
    # OK with a detail, so an offline install never looks broken here.
    services.append(_diarization_service())

    # Overall status
    statuses = [s.status for s in services]
    if all(s == "OK" for s in statuses):
        overall = "OK"
    elif "DEGRADED" in statuses:
        overall = "DEGRADED"
    else:
        overall = "WARMING_UP"

    return HealthResponse(status=overall, services=services)
