"""
Whisper ↔ pyannote segment alignment — PRD-01 §5.5

Two strategies:

1. Word-level alignment (preferred): assigns speakers per word using overlap
   with pyannote segments, then rebuilds display segments from consecutive
   same-speaker words. Handles speaker transitions within a sentence.

2. Majority overlap (fallback): assigns a single speaker per Whisper segment
   based on which pyannote speaker overlaps the most.

This is the testable core logic — no database or model dependencies.
"""
from typing import Optional


def assign_speakers_wordlevel(
    aligned_segments: list[dict],
    diarization_segments: list[dict],
) -> list[dict]:
    """
    Word-level speaker assignment preserving Whisper sentence boundaries.

    Assigns a speaker to each word via overlap with pyannote segments, then
    rebuilds segments that respect BOTH the original Whisper sentence boundaries
    AND speaker changes within a sentence. This keeps granular timestamps while
    correctly labeling speakers.

    Args:
        aligned_segments: WhisperX segments with "words" arrays, each word
                          having {"word": str, "start": float, "end": float}
        diarization_segments: list of {"speaker": str, "start": float, "end": float}

    Returns:
        list of rebuilt segments: {"start": float, "end": float, "text": str, "speaker": str}
    """
    # Tag each word with its speaker AND which original segment it came from
    tagged_words: list[dict] = []
    for seg_idx, seg in enumerate(aligned_segments):
        for w in seg.get("words", []):
            start = w.get("start")
            end = w.get("end")
            word_text = w.get("word", "")
            if start is not None and end is not None and word_text:
                speaker = _best_speaker_for_interval(
                    start, end, diarization_segments
                )
                tagged_words.append({
                    "word": word_text, "start": start, "end": end,
                    "speaker": speaker, "seg_idx": seg_idx,
                })

    if not tagged_words:
        return []

    # Rebuild segments: break on speaker change OR original segment boundary
    rebuilt = []
    cur = tagged_words[0]
    current_speaker = cur["speaker"]
    current_seg_idx = cur["seg_idx"]
    current_start = cur["start"]
    current_end = cur["end"]
    current_words = [cur["word"]]

    for tw in tagged_words[1:]:
        if tw["speaker"] == current_speaker and tw["seg_idx"] == current_seg_idx:
            current_end = tw["end"]
            current_words.append(tw["word"])
        else:
            rebuilt.append({
                "start": current_start,
                "end": current_end,
                "text": " ".join(w.strip() for w in current_words),
                "speaker": current_speaker,
            })
            current_speaker = tw["speaker"]
            current_seg_idx = tw["seg_idx"]
            current_start = tw["start"]
            current_end = tw["end"]
            current_words = [tw["word"]]

    rebuilt.append({
        "start": current_start,
        "end": current_end,
        "text": " ".join(w.strip() for w in current_words),
        "speaker": current_speaker,
    })

    return rebuilt


def _best_speaker_for_interval(
    start: float, end: float, diarization_segments: list[dict]
) -> str:
    """Find the speaker with the most overlap for a time interval."""
    best_speaker = "SPEAKER_00"
    best_overlap = 0.0
    best_start = float("inf")

    for d_seg in diarization_segments:
        overlap = _overlap(start, end, d_seg["start"], d_seg["end"])
        if overlap <= 0:
            continue
        if overlap > best_overlap or (
            overlap == best_overlap and d_seg["start"] < best_start
        ):
            best_overlap = overlap
            best_speaker = d_seg["speaker"]
            best_start = d_seg["start"]

    return best_speaker


def assign_speakers(
    transcript_segments: list[dict],
    diarization_segments: list[dict],
) -> dict[int, str]:
    """
    Fallback: segment-level majority overlap speaker assignment.

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
