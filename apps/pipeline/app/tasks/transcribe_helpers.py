"""
Helper utilities for transcription task bookkeeping.
"""
from __future__ import annotations

import json
from pathlib import Path


def estimate_fireworks_usage(
    segments_data: list[dict], fallback_duration_secs: int | None
) -> float:
    """
    Estimate billed audio seconds for Fireworks STT.

    Prefer transcript segment bounds; fall back to episode metadata.
    """
    max_end = 0.0
    for seg in segments_data:
        try:
            max_end = max(max_end, float(seg.get("end", 0.0) or 0.0))
        except Exception:
            continue
    if max_end > 0:
        return max_end
    return float(fallback_duration_secs or 0)


def compute_fireworks_cost(
    audio_secs: float, configured_rate_usd_per_minute: float
) -> tuple[float, float]:
    """
    Convert audio seconds and rate into billable minutes and rounded USD cost.
    """
    audio_minutes = round(audio_secs / 60.0, 3) if audio_secs > 0 else 0.0
    stt_cost_usd = round(audio_minutes * configured_rate_usd_per_minute, 4)
    return audio_minutes, stt_cost_usd


def remove_artifacts(*artifacts: Path) -> None:
    """
    Best-effort artifact cleanup.
    """
    for artifact in artifacts:
        if artifact.exists():
            try:
                artifact.unlink()
            except Exception:
                pass


def persist_transcription_artifacts(
    transcript_dir: str,
    episode_id: str,
    *,
    aligned_result: dict | None,
    fireworks_result: dict | None,
) -> tuple[Path, Path]:
    """
    Persist local/fireworks intermediate transcript artifacts when available.
    """
    out_dir = Path(transcript_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    alignment_path = out_dir / f"{episode_id}.whisperx.json"
    fireworks_path = out_dir / f"{episode_id}.fireworks.json"

    if aligned_result is not None:
        with open(alignment_path, "w") as f:
            json.dump(aligned_result, f)
    if fireworks_result is not None:
        with open(fireworks_path, "w") as f:
            json.dump(fireworks_result, f)

    return alignment_path, fireworks_path
