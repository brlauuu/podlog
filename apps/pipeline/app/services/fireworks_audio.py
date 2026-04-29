"""
Fireworks audio transcription helpers.

This service wraps Fireworks `/v1/audio/transcriptions` and normalizes the
response shape used by Podlog tasks.

For long episodes that exceed Fireworks's undocumented upload cap (#600),
``transcribe`` can be called with ``chunked=True`` to split the file with
:mod:`app.services.fireworks_audio_chunking` and stitch the per-chunk
responses back together (#610). Default behavior is unchanged: one
multipart upload, fail-fast on cap.
"""
from __future__ import annotations

import logging
import tempfile
from collections import Counter
from pathlib import Path

import httpx

from app.services import fireworks_audio_chunking as chunking

logger = logging.getLogger(__name__)


# Maximum bisect depth for chunked uploads when a chunk hits
# FIREWORKS_UPLOAD_REJECTED. Depth 2 means a chunk can split at most into
# 4 sub-chunks (1 -> 2 -> 4) before we give up with FIREWORKS_CHUNK_FAILED.
_BISECT_MAX_DEPTH = 2

# Refuse to bisect a range below this duration: at some point the cap
# isn't about size, and we should surface the failure to the user.
_MIN_BISECT_DURATION_SECS = 30.0


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
    """Return True when a network error looks like an upstream proxy abort.

    Fireworks (or its CDN) closes the TLS connection mid-upload when the
    request exceeds an undocumented size/duration limit. The client sees a
    TLS-layer alert — most commonly ``BAD_RECORD_MAC`` — instead of a clean
    HTTP 413/400. Repeated retries with backoff hit the same wall, so it's
    pointless to keep uploading; the user needs to know the file should be
    transcribed locally instead. See issue #600.
    """
    needles = ("BAD_RECORD_MAC", "SSLV3_ALERT_BAD_RECORD_MAC")
    return any(n in error_text for n in needles)


def _format_upload_rejected_message(audio_path: str, original_error: str) -> str:
    try:
        size_bytes = Path(audio_path).stat().st_size
        size_mb = size_bytes / (1024 * 1024)
        size_str = f"{size_mb:.0f} MB"
    except OSError:
        size_str = "unknown size"
    return (
        f"Fireworks rejected the upload (likely size/duration cap on a {size_str} file). "
        f"Re-run this episode on local inference. Underlying error: {original_error}"
    )


def _post_transcription(
    file_path: str | Path,
    *,
    api_key: str,
    audio_base_url: str,
    model_name: str,
    diarize: bool,
) -> dict:
    """Single multipart upload to Fireworks ``/v1/audio/transcriptions``.

    Returns the raw response dict; raises :class:`FireworksTranscriptionError`
    with retryability metadata on any HTTP/network failure. This is the
    inner primitive used by both the single-shot and chunked code paths.
    """
    path = Path(file_path)
    if not path.exists():
        raise RuntimeError(f"Audio file missing for Fireworks transcription: {path}")

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
                return resp.json()
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
                    _format_upload_rejected_message(str(path), error_text),
                    error_class="FIREWORKS_UPLOAD_REJECTED",
                    retryable=False,
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
                f"Fireworks API HTTP {status}",
                error_class=error_class,
                retryable=retryable,
                status_code=status,
            ) from exc


def _transcribe_range(
    src_audio_path: Path,
    range_start: float,
    range_end: float,
    *,
    workdir: Path,
    api_key: str,
    audio_base_url: str,
    model_name: str,
    diarize: bool,
    overlap_secs: int,
    max_retries: int,
    bisect_depth: int,
    chunk_label: str,
) -> dict:
    """Transcribe a [start, end] range of the source audio.

    Returns the raw response with timestamps in **range-local time**
    (start of the range = 0). Recursively bisects the range when Fireworks
    rejects the upload, until ``bisect_depth`` runs out.

    Retryable errors are retried up to ``max_retries`` times with no
    backoff (the request itself takes long enough; piling on backoff would
    slow chunked transcription unnecessarily).
    """
    range_duration = range_end - range_start
    chunk_filename = f"chunk_{chunk_label}.mp3"
    chunk_path = workdir / chunk_filename
    chunking.extract_chunk(
        src_audio_path,
        chunking.Chunk(index=0, start=range_start, end=range_end),
        chunk_path,
    )

    last_error: FireworksTranscriptionError | None = None
    for attempt in range(max_retries + 1):
        try:
            return _post_transcription(
                chunk_path,
                api_key=api_key,
                audio_base_url=audio_base_url,
                model_name=model_name,
                diarize=diarize,
            )
        except FireworksTranscriptionError as exc:
            last_error = exc
            if exc.error_class == "FIREWORKS_UPLOAD_REJECTED":
                # Cap reached on this range; bisect or surface.
                break
            if not exc.retryable:
                # Non-retryable terminal failure (e.g. HTTP_ACCESS-class).
                break
            logger.warning(
                '"action": "fireworks_chunk_retry", "label": "%s", "attempt": %d, '
                '"error_class": "%s", "error": "%s"',
                chunk_label,
                attempt + 1,
                exc.error_class,
                str(exc),
            )

    if last_error is None:
        # Defensive: the retry loop body either returns successfully or sets
        # last_error before breaking. Reaching here means a control-flow bug.
        raise RuntimeError(
            f"_transcribe_range exhausted retries without recording an error "
            f"(label={chunk_label!r})"
        )

    if last_error.error_class == "FIREWORKS_UPLOAD_REJECTED" and bisect_depth > 0:
        if range_duration < _MIN_BISECT_DURATION_SECS:
            raise FireworksTranscriptionError(
                f"Fireworks rejected upload of a {range_duration:.0f}s chunk "
                f"[{_range_label(range_start, range_end)}]; below bisect floor "
                f"({_MIN_BISECT_DURATION_SECS:.0f}s). Cap may not be size-related.",
                error_class="FIREWORKS_CHUNK_FAILED",
                retryable=False,
            ) from last_error

        logger.warning(
            '"action": "fireworks_chunk_bisect", "label": "%s", "duration_secs": %.1f, '
            '"depth_remaining": %d',
            chunk_label,
            range_duration,
            bisect_depth,
        )
        sub_chunks = chunking.plan_chunks(
            duration_secs=range_duration,
            target_secs=max(int(range_duration / 2) + overlap_secs, overlap_secs + 1),
            overlap_secs=overlap_secs,
        )
        sub_responses: list[dict] = []
        for sub in sub_chunks:
            sub_response = _transcribe_range(
                src_audio_path,
                range_start=range_start + sub.start,
                range_end=range_start + sub.end,
                workdir=workdir,
                api_key=api_key,
                audio_base_url=audio_base_url,
                model_name=model_name,
                diarize=diarize,
                overlap_secs=overlap_secs,
                max_retries=max_retries,
                bisect_depth=bisect_depth - 1,
                chunk_label=f"{chunk_label}.{sub.index}",
            )
            sub_responses.append(sub_response)
        # Stitch sub-responses into a single range-local response: each
        # sub_response has times relative to its own sub-range start
        # (which is sub.start within the parent range), so stitch_responses
        # with the original sub_chunks directly produces range-local times.
        return chunking.stitch_responses(sub_responses, sub_chunks)

    if last_error.error_class == "FIREWORKS_UPLOAD_REJECTED":
        raise FireworksTranscriptionError(
            f"Fireworks rejected upload of chunk [{_range_label(range_start, range_end)}] "
            f"after exhausting bisect depth. Re-run this episode on local inference.",
            error_class="FIREWORKS_CHUNK_FAILED",
            retryable=False,
        ) from last_error

    # Retry budget exhausted on a retryable error, or non-retryable error.
    raise FireworksTranscriptionError(
        f"Chunk [{_range_label(range_start, range_end)}] failed after "
        f"{max_retries + 1} attempts: {last_error}",
        error_class="FIREWORKS_CHUNK_FAILED",
        retryable=False,
    ) from last_error


def _range_label(start: float, end: float) -> str:
    """Format a range as ``MM:SS-MM:SS`` for log/error messages."""

    def fmt(secs: float) -> str:
        m, s = divmod(int(secs), 60)
        return f"{m}:{s:02d}"

    return f"{fmt(start)}-{fmt(end)}"


def transcribe(
    audio_path: str,
    *,
    api_key: str,
    audio_base_url: str,
    model_name: str,
    diarize: bool,
    chunked: bool = False,
    chunk_target_secs: int = 900,
    chunk_overlap_secs: int = 3,
    chunk_max_retries: int = 2,
) -> tuple[list[dict], str, dict]:
    """
    Transcribe audio with Fireworks.

    Returns ``(segments, language, raw_response)`` where segments follow
    Podlog's existing format: ``{"start": float, "end": float, "text": str}``.

    When ``chunked=False`` (default), behavior matches the historical
    single-shot upload — one multipart POST, fail-fast on the upload cap
    (#600). When ``chunked=True``, the file is split into pieces of
    ``chunk_target_secs`` with ``chunk_overlap_secs`` overlap, each piece
    is uploaded independently (with up to ``chunk_max_retries`` retries
    and bisect-on-cap), and the per-chunk responses are stitched back
    into a single response equivalent to one whole-file Fireworks call.
    """
    path = Path(audio_path)
    if not path.exists():
        raise RuntimeError(f"Audio file missing for Fireworks transcription: {audio_path}")

    if chunked:
        result = _transcribe_chunked(
            path,
            api_key=api_key,
            audio_base_url=audio_base_url,
            model_name=model_name,
            diarize=diarize,
            chunk_target_secs=chunk_target_secs,
            chunk_overlap_secs=chunk_overlap_secs,
            chunk_max_retries=chunk_max_retries,
        )
    else:
        result = _post_transcription(
            path,
            api_key=api_key,
            audio_base_url=audio_base_url,
            model_name=model_name,
            diarize=diarize,
        )

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
        '"action": "fireworks_transcribe_complete", "segments": %d, "language": "%s", '
        '"diarize": %s, "chunked": %s',
        len(segments),
        language,
        str(diarize).lower(),
        str(chunked).lower(),
    )
    return segments, language, result


def _transcribe_chunked(
    audio_path: Path,
    *,
    api_key: str,
    audio_base_url: str,
    model_name: str,
    diarize: bool,
    chunk_target_secs: int,
    chunk_overlap_secs: int,
    chunk_max_retries: int,
) -> dict:
    """Chunked path: split, upload each chunk, stitch back. Issue #610.

    Returns a single raw response in whole-file time, equivalent in shape
    to one Fireworks call against the entire audio.
    """
    duration_secs = chunking.probe_duration_secs(audio_path)
    chunks = chunking.plan_chunks(
        duration_secs=duration_secs,
        target_secs=chunk_target_secs,
        overlap_secs=chunk_overlap_secs,
    )
    logger.info(
        '"action": "fireworks_chunk_plan", "audio": "%s", "duration_secs": %.1f, '
        '"chunks": %d, "target_secs": %d, "overlap_secs": %d',
        audio_path.name,
        duration_secs,
        len(chunks),
        chunk_target_secs,
        chunk_overlap_secs,
    )

    chunk_responses: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="fireworks_chunks_") as workdir_str:
        workdir = Path(workdir_str)
        for chunk in chunks:
            chunk_response = _transcribe_range(
                audio_path,
                range_start=chunk.start,
                range_end=chunk.end,
                workdir=workdir,
                api_key=api_key,
                audio_base_url=audio_base_url,
                model_name=model_name,
                diarize=diarize,
                overlap_secs=chunk_overlap_secs,
                max_retries=chunk_max_retries,
                bisect_depth=_BISECT_MAX_DEPTH,
                chunk_label=str(chunk.index),
            )
            chunk_responses.append(chunk_response)

    return chunking.stitch_responses(chunk_responses, chunks)


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
