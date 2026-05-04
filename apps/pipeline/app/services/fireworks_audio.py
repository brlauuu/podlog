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
    - other 4xx map to HTTP_ACCESS and follow standard retry policy.
    """
    if status_code == 429 or 500 <= status_code <= 599:
        return "TRANSIENT_NETWORK", True
    return "HTTP_ACCESS", True


def _is_upload_rejected_signature(error_text: str) -> bool:
    """Return True when a network error looks like a Fireworks upload abort.

    Fireworks (or its CDN) sometimes closes the TLS connection mid-upload.
    The client sees a TLS-layer alert — most commonly ``BAD_RECORD_MAC`` —
    instead of a clean HTTP 4xx/5xx. Originally classified as non-retryable
    on the assumption it indicated a hard size/duration cap (issue #600),
    but bulk-reprocessing data (issue #641) showed it's transient: the same
    episode IDs across the full duration/size range fail at a steady ~14%
    rate, with retries succeeding ~99% of the time. We now classify this
    as retryable so the standard ``retry_max`` budget recovers from it.
    """
    needles = ("BAD_RECORD_MAC", "SSLV3_ALERT_BAD_RECORD_MAC")
    return any(n in error_text for n in needles)


def _format_http_error(status: int, response: "httpx.Response") -> str:
    """Build a Fireworks HTTP error message that includes the response body
    detail so the user can see *why* it failed (e.g. unsupported format,
    file too large, missing field) instead of just ``HTTP 400`` (#650).
    """
    detail = ""
    try:
        body = response.json()
    except Exception:
        # Response body wasn't JSON (or wasn't valid). Fall through to the
        # plain-text path below.
        body = None
    if isinstance(body, dict):
        # OpenAI-compatible error shape: {"error": {"message": "...", ...}}
        err = body.get("error")
        if isinstance(err, dict):
            detail = str(err.get("message") or "").strip()
        elif isinstance(err, str):
            detail = err.strip()
        if not detail:
            detail = str(body.get("message") or body.get("detail") or "").strip()
    if not detail:
        try:
            detail = response.text.strip()
        except Exception:
            detail = ""
    detail = detail[:500]
    return f"Fireworks API HTTP {status}" + (f": {detail}" if detail else "")


def _format_upload_rejected_message(audio_path: str, original_error: str) -> str:
    try:
        size_bytes = Path(audio_path).stat().st_size
        size_mb = size_bytes / (1024 * 1024)
        size_str = f"{size_mb:.0f} MB"
    except OSError:
        size_str = "unknown size"
    return (
        f"Fireworks rejected the upload mid-stream (TLS abort) on a {size_str} file. "
        f"Transient — the task layer will retry. Underlying error: {original_error}"
    )


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
            error_text = str(exc)
            if _is_upload_rejected_signature(error_text):
                raise FireworksTranscriptionError(
                    _format_upload_rejected_message(audio_path, error_text),
                    error_class="FIREWORKS_UPLOAD_REJECTED",
                    retryable=True,
                ) from exc
            raise FireworksTranscriptionError(
                f"Fireworks network error: {error_text}",
                error_class="TRANSIENT_NETWORK",
                retryable=True,
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            error_class, retryable = _classify_http_error(status)
            raise FireworksTranscriptionError(
                _format_http_error(status, exc.response),
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


def rebuild_segments_from_words(raw: dict) -> list[dict]:
    """
    Rebuild sentence-level segments from Fireworks word-level speaker data.

    Mirrors the WhisperX word-level alignment path used by the local provider:
    groups consecutive same-speaker words into sentence-level DB segments,
    splitting on speaker changes, Fireworks segment boundaries, AND sentence-
    ending punctuation (``.`` ``?`` ``!``).

    WhisperX aligned_segments are already sentence-level, so the local path
    gets fine granularity for free.  Fireworks segments are much coarser
    (often minutes long), so this function must detect sentence boundaries
    itself to produce the same ~5-15 second segments that the local path
    yields.

    Returns list of {"start": float, "end": float, "text": str, "speaker": str}.
    Returns empty list if word-level speaker data is unavailable (caller falls back).
    """
    words = raw.get("words", []) or []
    segments = raw.get("segments", []) or []

    if not words:
        return []

    # Build ordered segment end-times to map each word to its parent segment.
    # Fireworks words always fall within a segment boundary, so we iterate
    # segments in order and assign each word to the first segment whose end
    # time is after the word's start.
    seg_ends = [float(s.get("end", 0.0)) for s in segments]

    def _seg_idx_for(word_start: float) -> int:
        for i, end in enumerate(seg_ends):
            if word_start < end + 0.05:  # small tolerance for rounding
                return i
        return max(0, len(seg_ends) - 1)

    # Build tagged word list (skip words missing required fields).
    tagged: list[dict] = []
    for w in words:
        start = w.get("start")
        end = w.get("end")
        word_text = w.get("word", "")
        speaker_id = w.get("speaker_id")
        if start is None or end is None or not word_text:
            continue
        tagged.append({
            "word": word_text,
            "start": float(start),
            "end": float(end),
            "speaker": _normalize_speaker(str(speaker_id)) if speaker_id is not None else None,
            "seg_idx": _seg_idx_for(float(start)),
        })

    if not tagged:
        return []

    # If no word has a speaker label, can't rebuild with diarization.
    if not any(w["speaker"] for w in tagged):
        return []

    # Propagate speaker labels forward/backward to cover unlabeled words.
    last_known: str | None = None
    for w in tagged:
        if w["speaker"] is not None:
            last_known = w["speaker"]
        elif last_known is not None:
            w["speaker"] = last_known
    # Fill any remaining gaps at the start (backward pass).
    first_known = next((w["speaker"] for w in tagged if w["speaker"]), "SPEAKER_00")
    for w in tagged:
        if w["speaker"] is None:
            w["speaker"] = first_known

    # Rebuild segments: split on speaker change, original segment boundary,
    # OR sentence-ending punctuation. The local WhisperX path gets sentence-
    # level granularity because WhisperX aligned_segments are already per-
    # sentence. Fireworks segments are much coarser (minutes), so we must
    # detect sentence boundaries ourselves via terminal punctuation.
    rebuilt: list[dict] = []
    cur = tagged[0]
    c_speaker = cur["speaker"]
    c_seg = cur["seg_idx"]
    c_start = cur["start"]
    c_end = cur["end"]
    c_words: list[str] = [cur["word"]]

    def _flush() -> None:
        rebuilt.append({
            "start": c_start,
            "end": c_end,
            "text": " ".join(w.strip() for w in c_words),
            "speaker": c_speaker,
        })

    for tw in tagged[1:]:
        same_speaker = tw["speaker"] == c_speaker
        same_seg = tw["seg_idx"] == c_seg
        sentence_ended = _is_sentence_end(c_words[-1])

        if same_speaker and same_seg and not sentence_ended:
            c_end = tw["end"]
            c_words.append(tw["word"])
        else:
            _flush()
            c_speaker = tw["speaker"]
            c_seg = tw["seg_idx"]
            c_start = tw["start"]
            c_end = tw["end"]
            c_words = [tw["word"]]

    _flush()

    return rebuilt


def _is_sentence_end(word: str) -> bool:
    """Detect likely sentence-ending punctuation on a word.

    Returns True for words like ``"sentence."`` or ``"question?"`` but
    False for decimal numbers like ``"3.5"`` where the period is not a
    sentence terminator.
    """
    stripped = word.rstrip()
    if not stripped or stripped[-1] not in ".?!":
        return False
    # Avoid false positives on decimal numbers (e.g. "3.5", "1.")
    if len(stripped) >= 2 and stripped[-2].isdigit():
        return False
    return True


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
