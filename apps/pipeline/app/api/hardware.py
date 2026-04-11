"""Hardware detection API — returns detected hardware and processing estimates."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.hardware import detect_hardware, get_hardware_profile, estimate_processing_times
from app.services.notification_settings import get_notification_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/hardware")
def get_hardware(db: Session = Depends(get_db)):
    """Return detected hardware info and processing time estimates."""
    hw = detect_hardware()
    profile = get_hardware_profile()
    ns = get_notification_settings(db)
    cost_per_minute = ns.get("fireworks_stt_cost_per_minute_usd", 0.006)
    estimates = estimate_processing_times(profile, cost_per_minute)

    return {
        "hardware": hw,
        "profile": profile["name"] if profile else None,
        "profile_label": profile["label"] if profile else None,
        "estimates": estimates,
    }
