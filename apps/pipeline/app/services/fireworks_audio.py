"""
Fireworks audio transcription helpers.

This service wraps Fireworks `/v1/audio/transcriptions` and normalizes the
response shape used by Podlog tasks.
"""
from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


class FireworksTranscriptionError(RuntimeError):
    """Typed Fireworks transcription error with retryability metadata."""

    def __init__(
        self,
        message: str,
        *,
        error_class: str,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.retryable = retryable
        self.status_code = status_code


def _audio_url(base_url: str) -> str:
    return base_url.rstrip("/") + "/v1/audio/transcriptions"


def _classify_http_error(status_code: int) -> tuple[str, bool]:
    """
    Classify Fireworks API HTTP errors into Podlog error classes.

    Returns `(error_class, retryable)`:
    - 429 and 5xx are transient and retryable.
    - other 4xx are access/config failures and non-retryable.
    """
    if status_code == 429 or 500 <= status_code <= 599:
        return "TRANSIENT_NETWORK", True
    return "HTTP_ACCESS", False


def transcribe(
    audio_path: str,
    *,
    api_key: str,
    audio_base_url: str,
    model_name: str,
    diarize: bool,
) -> tuple[list[dict], str, dict]:
    """
    Transcribe audio with Fireworks.

    Returns `(segments, language, raw_response)` where segments follow Podlog's
    existing format: `{"start": float, "end": float, "text": str}`.
    """
    path = Path(audio_path)
    if not path.exists():
        raise RuntimeError(f"Audio file missing for Fireworks transcription: {audio_path}")

    data = {
        "model": model_name,
        "response_format": "verbose_json",
        "diarize": str(bool(diarize)).lower(),
    }
    # Request both levels when available so downstream diarization can map cleanly.
    data["timestamp_granularities[]"] = ["segment", "word"]

    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = httpx.Timeout(connect=30.0, read=600.0, write=600.0, pool=60.0)

    with path.open("rb") as audio_fh:
        files = {"file": (path.name, audio_fh, "application/octet-stream")}
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    _audio_url(audio_base_url), headers=headers, data=data, files=files
                )
                resp.raise_for_status()
                result = resp.json()
        except httpx.TimeoutException as exc:
            raise FireworksTranscriptionError(
                f"Fireworks transcription timeout: {exc}",
                error_class="TRANSIENT_NETWORK",
                retryable=True,
            ) from exc
        except httpx.NetworkError as exc:
            raise FireworksTranscriptionError(
                f"Fireworks network error: {exc}",
                error_class="TRANSIENT_NETWORK",
                retryable=True,
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            error_class, retryable = _classify_http_error(status)
            raise FireworksTranscriptionError(
                f"Fireworks API HTTP {status}",
                error_class=error_class,
                retryable=retryable,
                status_code=status,
            ) from exc

    raw_segments = result.get("segments", []) or []
    segments: list[dict] = []
    for seg in raw_segments:
        segments.append(
            {
                "start": float(seg.get("start", 0.0) or 0.0),
                "end": float(seg.get("end", 0.0) or 0.0),
                "text": (seg.get("text", "") or "").strip(),
            }
        )

    language = result.get("language", "unknown") or "unknown"
    logger.info(
        '"action": "fireworks_transcribe_complete", "segments": %d, "language": "%s", "diarize": %s',
        len(segments),
        language,
        str(diarize).lower(),
    )
    return segments, language, result


def diarization_segments_from_transcription(raw: dict) -> list[dict]:
    """
    Build pyannote-like diarization segments from Fireworks transcript words.

    Output format:
      {"speaker": "SPEAKER_00", "start": float, "end": float}
    """
    words = raw.get("words", []) or []
    labeled: list[dict] = []
    for word in words:
        speaker = word.get("speaker_id")
        start = word.get("start")
        end = word.get("end")
        if speaker is None or start is None or end is None:
            continue
        labeled.append(
            {
                "speaker": _normalize_speaker(str(speaker)),
                "start": float(start),
                "end": float(end),
            }
        )

    if not labeled:
        return []

    merged: list[dict] = []
    current = dict(labeled[0])
    for item in labeled[1:]:
        if item["speaker"] == current["speaker"] and item["start"] <= current["end"] + 0.05:
            current["end"] = max(current["end"], item["end"])
            continue
        merged.append(current)
        current = dict(item)
    merged.append(current)
    return merged


def assign_segment_speakers_from_words(transcript_segments: list[dict], raw: dict) -> dict[int, str]:
    """
    Fallback speaker assignment using majority overlap with Fireworks words.

    Returns mapping: `segment_id -> speaker_label`.
    """
    words = raw.get("words", []) or []
    if not words:
        return {}

    assignments: dict[int, str] = {}
    for seg in transcript_segments:
        seg_id = seg["id"]
        seg_start = float(seg["start"])
        seg_end = float(seg["end"])

        counter: Counter[str] = Counter()
        for w in words:
            speaker_id = w.get("speaker_id")
            start = w.get("start")
            end = w.get("end")
            if speaker_id is None or start is None or end is None:
                continue
            ov = _overlap(seg_start, seg_end, float(start), float(end))
            if ov > 0:
                counter[_normalize_speaker(str(speaker_id))] += ov

        if counter:
            assignments[seg_id] = counter.most_common(1)[0][0]

    return assignments


def _normalize_speaker(raw_speaker: str) -> str:
    clean = raw_speaker.strip().replace("-", "_").upper()
    if clean.startswith("SPEAKER_"):
        return clean
    if clean.isdigit():
        return f"SPEAKER_{int(clean):02d}"
    if clean.startswith("SPEAKER") and clean[7:].isdigit():
        return f"SPEAKER_{int(clean[7:]):02d}"
    return f"SPEAKER_{clean}"


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))
