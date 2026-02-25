"""
Whisper ↔ pyannote segment alignment — PRD-01 §5.5

Strategy: majority overlap.
  For each Whisper segment, find the pyannote speaker whose time range
  overlaps the most. In case of a tie, prefer the earlier-starting speaker.

This is the testable core logic — no database or model dependencies.
"""
from typing import Optional


def assign_speakers(
    transcript_segments: list[dict],
    diarization_segments: list[dict],
) -> dict[int, str]:
    """
    Assign a speaker label to each transcript segment.

    Args:
        transcript_segments: list of {"id": int, "start": float, "end": float}
        diarization_segments: list of {"speaker": str, "start": float, "end": float}

    Returns:
        dict mapping segment id → speaker label (e.g. "SPEAKER_00")
    """
    assignments: dict[int, str] = {}

    for seg in transcript_segments:
        seg_start = seg["start"]
        seg_end = seg["end"]
        seg_duration = seg_end - seg_start

        if seg_duration <= 0:
            assignments[seg["id"]] = "SPEAKER_00"
            continue

        best_speaker: Optional[str] = None
        best_overlap = 0.0
        best_start = float("inf")

        for d_seg in diarization_segments:
            overlap = _overlap(seg_start, seg_end, d_seg["start"], d_seg["end"])
            if overlap <= 0:
                continue

            if overlap > best_overlap or (
                overlap == best_overlap and d_seg["start"] < best_start
            ):
                best_overlap = overlap
                best_speaker = d_seg["speaker"]
                best_start = d_seg["start"]

        if best_speaker:
            assignments[seg["id"]] = best_speaker

    return assignments


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    """Return the duration of overlap between two time intervals."""
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))
