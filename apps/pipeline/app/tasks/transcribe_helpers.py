"""
Helper utilities for transcription task bookkeeping.
"""
from __future__ import annotations

import json
from pathlib import Path


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
    transcript_dir: str, episode_id: str, *, aligned_result: dict
) -> Path:
    """
    Persist the WhisperX alignment result that diarization reads.
    """
    out_dir = Path(transcript_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    alignment_path = out_dir / f"{episode_id}.whisperx.json"
    with open(alignment_path, "w") as f:
        json.dump(aligned_result, f)
    return alignment_path
