"""
Fireworks audio chunking helpers — Issue #610.

Splits a long audio file into shorter overlapping chunks for upload to
Fireworks ``/v1/audio/transcriptions`` (which has an undocumented size cap;
see #600), then stitches per-chunk transcription responses back into a
single response equivalent to one Fireworks call against the whole file.

Public surface:

  - :class:`Chunk` — dataclass describing one piece of the audio timeline.
  - :func:`plan_chunks` — pure function turning ``(duration, target, overlap)``
    into ``list[Chunk]``. No I/O.
  - :func:`probe_duration_secs` — read total duration from the audio file
    via ffprobe.
  - :func:`extract_chunk` — write one chunk to disk via ``ffmpeg -ss/-t``.
  - :func:`stitch_responses` — merge per-chunk Fireworks responses into a
    single response with timestamps in whole-episode time and seam
    duplicates removed. Output schema matches the upstream API so existing
    consumers (``diarization_segments_from_transcription``,
    ``rebuild_segments_from_words``, ``assign_segment_speakers_from_words``
    in :mod:`app.services.fireworks_audio`) work unchanged.

This module is intentionally I/O-light and side-effect-free except for
``probe_duration_secs`` and ``extract_chunk``. The wiring into
``fireworks_audio.transcribe`` (per-chunk upload loop, retry, bisect) lives
in PR 2 — see #610.
"""
from __future__ import annotations

import json
import logging
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Chunk:
    """One piece of the audio timeline, in seconds.

    ``index`` is the 0-based position in the chunk sequence; ``start`` and
    ``end`` are absolute offsets into the source audio. Adjacent chunks
    overlap by ``overlap_secs`` (so ``chunks[i+1].start < chunks[i].end``)
    to give the seam-dedupe in :func:`stitch_responses` something to anchor
    on if a word straddles the cut.
    """

    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def plan_chunks(
    duration_secs: float,
    target_secs: int,
    overlap_secs: int,
) -> list[Chunk]:
    """Plan an even-time chunk schedule covering ``[0, duration_secs]``.

    Each chunk is ``target_secs`` long and overlaps the next by
    ``overlap_secs``; the final chunk is truncated at ``duration_secs``
    and may be shorter (down to a single sample past the previous chunk's
    seam). A single chunk is returned when the file is shorter than the
    target — chunking would be pointless.

    The schedule is purely time-based; aligning cuts to silence boundaries
    is a future quality improvement and slots in by replacing the boundary
    arithmetic here without changing the function's contract.
    """
    if duration_secs <= 0:
        raise ValueError(f"duration_secs must be positive, got {duration_secs!r}")
    if target_secs <= 0:
        raise ValueError(f"target_secs must be positive, got {target_secs!r}")
    if overlap_secs < 0:
        raise ValueError(f"overlap_secs must be >= 0, got {overlap_secs!r}")
    if overlap_secs >= target_secs:
        raise ValueError(
            f"overlap_secs ({overlap_secs}) must be < target_secs ({target_secs})"
        )

    if duration_secs <= target_secs:
        return [Chunk(index=0, start=0.0, end=float(duration_secs))]

    step = target_secs - overlap_secs
    chunks: list[Chunk] = []
    start = 0.0
    index = 0
    while start < duration_secs:
        end = min(start + target_secs, duration_secs)
        chunks.append(Chunk(index=index, start=float(start), end=float(end)))
        if end >= duration_secs:
            break
        start += step
        index += 1
    return chunks


def probe_duration_secs(audio_path: str | Path) -> float:
    """Return the audio duration in seconds via ``ffprobe``.

    Raises ``RuntimeError`` on probe failure.
    """
    path = Path(audio_path)
    if not path.exists():
        raise RuntimeError(f"Audio file missing: {path}")
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        raise RuntimeError(f"ffprobe failed for {path.name}: {stderr.strip()[:500]}") from exc

    try:
        payload = json.loads(result.stdout)
        duration = float(payload["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            f"ffprobe returned unparseable duration for {path.name}: {result.stdout[:200]}"
        ) from exc

    if duration <= 0:
        raise RuntimeError(f"ffprobe reported non-positive duration for {path.name}: {duration}")
    return duration


def extract_chunk(
    audio_path: str | Path,
    chunk: Chunk,
    out_path: str | Path,
) -> Path:
    """Write a single chunk of the source audio to ``out_path`` via ffmpeg.

    Uses stream copy (``-c copy``) to avoid re-encoding — fast, lossless,
    and good enough for MP3/AAC/Opus where keyframe granularity is small.
    Raises ``RuntimeError`` on ffmpeg failure with a stderr tail.
    """
    src = Path(audio_path)
    dst = Path(out_path)
    if not src.exists():
        raise RuntimeError(f"Audio file missing: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-ss",
                f"{chunk.start:.3f}",
                "-t",
                f"{chunk.duration:.3f}",
                "-i",
                str(src),
                "-c",
                "copy",
                str(dst),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        stderr = getattr(exc, "stderr", b"") or b""
        tail = stderr.decode(errors="replace").strip()[-1024:]
        raise RuntimeError(
            f"ffmpeg chunk extract failed for {src.name} "
            f"[{chunk.start:.1f}s..{chunk.end:.1f}s]: {tail or 'no stderr captured'}"
        ) from exc

    return dst


# ---------------------------------------------------------------------------
# Stitching
# ---------------------------------------------------------------------------


def _shifted(items: list[dict], offset: float, *, keys: tuple[str, ...]) -> list[dict]:
    """Return a copy of ``items`` with each timestamp key shifted by ``offset``."""
    out: list[dict] = []
    for item in items:
        new = dict(item)
        for key in keys:
            value = new.get(key)
            if isinstance(value, (int, float)):
                new[key] = float(value) + offset
        out.append(new)
    return out


def _drop_words_in_overlap(
    earlier: list[dict],
    later: list[dict],
    seam_start: float,
    seam_end: float,
) -> tuple[list[dict], list[dict]]:
    """Resolve word-level duplicates in the seam window.

    Both chunks may have transcribed the same audio in ``[seam_start,
    seam_end]``. Strategy: keep the earlier chunk's words up to the seam
    midpoint, keep the later chunk's words from the seam midpoint onward.
    Anything outside the seam window is untouched.

    This is deliberately simple. A fancier approach (longest-common-
    subsequence of word strings) would handle slight transcription
    differences across chunks more gracefully, but it's not required for
    correctness — short duplicates near the seam don't break downstream
    consumers, and dropping a real word at the seam is the worse failure
    mode. The midpoint cut keeps both risks bounded.
    """
    if seam_end <= seam_start:
        return earlier, later
    midpoint = (seam_start + seam_end) / 2.0

    earlier_kept = [w for w in earlier if float(w.get("start", 0.0)) < midpoint]
    later_kept = [w for w in later if float(w.get("start", 0.0)) >= midpoint]
    return earlier_kept, later_kept


def _drop_segments_in_overlap(
    earlier: list[dict],
    later: list[dict],
    seam_start: float,
    seam_end: float,
) -> tuple[list[dict], list[dict]]:
    """Apply the same midpoint-split rule to coarse segments."""
    if seam_end <= seam_start:
        return earlier, later
    midpoint = (seam_start + seam_end) / 2.0

    earlier_kept = [s for s in earlier if float(s.get("start", 0.0)) < midpoint]
    later_kept = [s for s in later if float(s.get("start", 0.0)) >= midpoint]
    return earlier_kept, later_kept


def stitch_responses(
    chunk_responses: list[dict],
    chunks: list[Chunk],
) -> dict:
    """Merge per-chunk Fireworks responses into a single response.

    The output dict matches the shape of one Fireworks call:

      ``{"language": str, "segments": [...], "words": [...]}``

    All segment/word ``start``/``end`` values are converted to
    whole-episode time. In the overlap region between adjacent chunks,
    duplicates are resolved by midpoint split — earlier chunk owns the
    first half of the seam, later chunk owns the second half. See
    :func:`_drop_words_in_overlap` for rationale.
    """
    if len(chunk_responses) != len(chunks):
        raise ValueError(
            f"chunk_responses length ({len(chunk_responses)}) does not match "
            f"chunks length ({len(chunks)})"
        )
    if not chunks:
        return {"language": "unknown", "segments": [], "words": []}

    shifted_segments: list[list[dict]] = []
    shifted_words: list[list[dict]] = []
    languages: list[str] = []
    for resp, chunk in zip(chunk_responses, chunks):
        offset = chunk.start
        segs = list(resp.get("segments") or [])
        words = list(resp.get("words") or [])
        shifted_segments.append(
            _shifted(segs, offset, keys=("start", "end"))
        )
        shifted_words.append(
            _shifted(words, offset, keys=("start", "end"))
        )
        lang = resp.get("language")
        if isinstance(lang, str) and lang:
            languages.append(lang)

    # Resolve overlap seams pairwise.
    for i in range(len(chunks) - 1):
        seam_start = chunks[i + 1].start
        seam_end = chunks[i].end
        if seam_end <= seam_start:
            continue
        shifted_words[i], shifted_words[i + 1] = _drop_words_in_overlap(
            shifted_words[i], shifted_words[i + 1], seam_start, seam_end
        )
        shifted_segments[i], shifted_segments[i + 1] = _drop_segments_in_overlap(
            shifted_segments[i], shifted_segments[i + 1], seam_start, seam_end
        )

    merged_segments: list[dict] = []
    for segs in shifted_segments:
        merged_segments.extend(segs)
    merged_words: list[dict] = []
    for words in shifted_words:
        merged_words.extend(words)

    # Pick the most common language, preferring chunk 0's choice on ties.
    language = "unknown"
    if languages:
        first = languages[0]
        if all(lang == first for lang in languages):
            language = first
        else:
            language = Counter(languages).most_common(1)[0][0]

    logger.info(
        '"action": "fireworks_chunk_stitch", "chunks": %d, "segments": %d, '
        '"words": %d, "language": "%s"',
        len(chunks),
        len(merged_segments),
        len(merged_words),
        language,
    )
    return {
        "language": language,
        "segments": merged_segments,
        "words": merged_words,
    }
