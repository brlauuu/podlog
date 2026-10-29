"""Hardware detection API — returns detected hardware and processing estimates."""
import logging

from fastapi import APIRouter

from app.services.hardware import detect_hardware, get_hardware_profile, estimate_processing_times

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/hardware")
def get_hardware():
    """Return detected hardware info and processing time estimates."""
    hw = detect_hardware()
    profile = get_hardware_profile()
    estimates = estimate_processing_times(profile)

    return {
        "hardware": hw,
        "profile": profile["name"] if profile else None,
        "profile_label": profile["label"] if profile else None,
        "estimates": estimates,
    }
