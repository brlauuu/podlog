"""Hardware detection and performance profile matching for cost estimates.

Reads /proc/cpuinfo and /proc/meminfo to identify local hardware, then maps
to a known performance profile. Used by the Settings UI to show estimated
local vs remote processing times.
"""
import logging
import re

from app.config import settings

logger = logging.getLogger(__name__)

# Performance profiles: maps profile name to estimated processing speeds.
# transcription_factor: minutes of processing per minute of audio (lower = faster)
# embedding_factor: seconds to embed one hour of chunked audio
HARDWARE_PROFILES: dict[str, dict] = {
    "cpu-only-4core": {
        "name": "cpu-only-4core",
        "label": "4-core CPU, no GPU",
        "transcription_factor": 1.0,
        "embedding_factor": 120,
    },
    "cpu-only-8core": {
        "name": "cpu-only-8core",
        "label": "8-core CPU, no GPU",
        "transcription_factor": 0.75,
        "embedding_factor": 90,
    },
    "cpu-only-16core": {
        "name": "cpu-only-16core",
        "label": "16-core CPU, no GPU",
        "transcription_factor": 0.5,
        "embedding_factor": 60,
    },
    "gpu-rtx3060": {
        "name": "gpu-rtx3060",
        "label": "GPU (RTX 3060 class)",
        "transcription_factor": 0.1,
        "embedding_factor": 15,
    },
    "gpu-rtx3080": {
        "name": "gpu-rtx3080",
        "label": "GPU (RTX 3080+ class)",
        "transcription_factor": 0.06,
        "embedding_factor": 10,
    },
}

# Remote processing estimates (Fireworks AI)
REMOTE_TRANSCRIPTION_FACTOR = 0.05  # ~3 min per 60 min audio
REMOTE_EMBEDDING_FACTOR = 5  # ~5 seconds per hour of chunked audio


def _check_gpu() -> str | None:
    """Check for CUDA GPU availability. Returns GPU name or None."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except ImportError:
        pass
    return None


def detect_hardware() -> dict | None:
    """Auto-detect CPU, RAM, and GPU from system info.

    Returns dict with cpu, cores, ram_gb, gpu keys, or None if detection fails.
    """
    try:
        with open("/proc/cpuinfo") as f:
            cpuinfo = f.read()
    except OSError:
        logger.warning('"action": "hardware_detection_failed", "reason": "cannot read /proc/cpuinfo"')
        return None

    try:
        with open("/proc/meminfo") as f:
            meminfo = f.read()
    except OSError:
        logger.warning('"action": "hardware_detection_failed", "reason": "cannot read /proc/meminfo"')
        return None

    # Parse CPU model name
    cpu_match = re.search(r"model name\s*:\s*(.+)", cpuinfo)
    cpu = cpu_match.group(1).strip() if cpu_match else "Unknown CPU"

    # Count processor entries
    cores = len(re.findall(r"^processor\s*:", cpuinfo, re.MULTILINE))

    # Parse total RAM
    mem_match = re.search(r"MemTotal:\s*(\d+)\s*kB", meminfo)
    ram_gb = int(mem_match.group(1)) / (1024 * 1024) if mem_match else 0

    gpu = _check_gpu()

    return {"cpu": cpu, "cores": cores, "ram_gb": round(ram_gb, 1), "gpu": gpu}


def _match_profile(hw: dict) -> dict | None:
    """Match detected hardware to the closest performance profile."""
    if hw.get("gpu"):
        gpu_name = hw["gpu"].lower()
        if any(x in gpu_name for x in ["4090", "4080", "3090", "3080", "a100", "a6000"]):
            return HARDWARE_PROFILES["gpu-rtx3080"]
        return HARDWARE_PROFILES["gpu-rtx3060"]

    cores = hw.get("cores", 4)
    if cores >= 12:
        return HARDWARE_PROFILES["cpu-only-16core"]
    elif cores >= 6:
        return HARDWARE_PROFILES["cpu-only-8core"]
    return HARDWARE_PROFILES["cpu-only-4core"]


def get_hardware_profile() -> dict | None:
    """Get the hardware profile, checking env override first, then auto-detecting.

    Returns the profile dict or None if detection fails and no override is set.
    """
    if settings.hardware_profile:
        profile = HARDWARE_PROFILES.get(settings.hardware_profile)
        if profile:
            return profile
        logger.warning(
            '"action": "unknown_hardware_profile", "profile": "%s"',
            settings.hardware_profile,
        )

    hw = detect_hardware()
    if hw is None:
        return None
    return _match_profile(hw)


def estimate_processing_times(profile: dict | None, cost_per_minute: float) -> dict:
    """Estimate local and remote processing times for a 60-minute episode.

    Args:
        profile: Hardware profile dict (or None if detection failed)
        cost_per_minute: Remote STT cost in USD per minute of audio

    Returns dict with local and remote estimates.
    """
    remote_transcription = round(REMOTE_TRANSCRIPTION_FACTOR * 60, 1)
    remote_cost = round(cost_per_minute * 60, 2)
    remote_embedding = REMOTE_EMBEDDING_FACTOR

    if profile is None:
        return {
            "transcription_minutes_per_hour": None,
            "embedding_seconds_per_hour": None,
            "remote_transcription_minutes_per_hour": remote_transcription,
            "remote_embedding_seconds_per_hour": remote_embedding,
            "remote_cost_per_hour_usd": remote_cost,
        }

    return {
        "transcription_minutes_per_hour": round(profile["transcription_factor"] * 60, 1),
        "embedding_seconds_per_hour": profile["embedding_factor"],
        "remote_transcription_minutes_per_hour": remote_transcription,
        "remote_embedding_seconds_per_hour": remote_embedding,
        "remote_cost_per_hour_usd": remote_cost,
    }


def validate_fireworks_key(api_key: str) -> bool:
    """Validate a Fireworks API key by making a lightweight API call.

    Returns True if the key appears valid, False otherwise.
    """
    import httpx

    try:
        resp = httpx.get(
            "https://api.fireworks.ai/inference/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        logger.warning('"action": "fireworks_key_validation_failed"')
        return False
