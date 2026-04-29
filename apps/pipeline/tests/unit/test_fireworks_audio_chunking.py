"""Unit tests for app.services.fireworks_audio_chunking (Issue #610)."""
from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from app.services.fireworks_audio_chunking import (
    Chunk,
    plan_chunks,
    probe_duration_secs,
    stitch_responses,
)


# ---------------------------------------------------------------------------
# plan_chunks
# ---------------------------------------------------------------------------


def test_plan_chunks_short_file_returns_single_chunk():
    """A file shorter than target_secs is one chunk; no point splitting."""
    chunks = plan_chunks(duration_secs=120.0, target_secs=900, overlap_secs=3)
    assert chunks == [Chunk(index=0, start=0.0, end=120.0)]


def test_plan_chunks_exactly_target_returns_single_chunk():
    chunks = plan_chunks(duration_secs=900.0, target_secs=900, overlap_secs=3)
    assert chunks == [Chunk(index=0, start=0.0, end=900.0)]


def test_plan_chunks_two_chunks_with_overlap():
    """A file slightly longer than target produces two overlapping chunks."""
    chunks = plan_chunks(duration_secs=1500.0, target_secs=900, overlap_secs=3)
    assert len(chunks) == 2
    assert chunks[0] == Chunk(index=0, start=0.0, end=900.0)
    # second chunk starts step = target - overlap = 897s in
    assert chunks[1].index == 1
    assert chunks[1].start == 897.0
    assert chunks[1].end == 1500.0
    # overlap exists
    assert chunks[0].end > chunks[1].start


def test_plan_chunks_long_file_covers_full_duration():
    chunks = plan_chunks(duration_secs=8000.0, target_secs=900, overlap_secs=3)
    assert chunks[0].start == 0.0
    assert chunks[-1].end == pytest.approx(8000.0)
    # Each adjacent pair overlaps by 3s.
    for a, b in zip(chunks, chunks[1:]):
        assert a.end > b.start
        assert pytest.approx(a.end - b.start) == 3.0


def test_plan_chunks_zero_overlap_chunks_are_contiguous():
    chunks = plan_chunks(duration_secs=2700.0, target_secs=900, overlap_secs=0)
    assert len(chunks) == 3
    for a, b in zip(chunks, chunks[1:]):
        assert a.end == b.start


def test_plan_chunks_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        plan_chunks(duration_secs=0.0, target_secs=900, overlap_secs=3)
    with pytest.raises(ValueError):
        plan_chunks(duration_secs=100.0, target_secs=0, overlap_secs=3)
    with pytest.raises(ValueError):
        plan_chunks(duration_secs=100.0, target_secs=900, overlap_secs=-1)
    with pytest.raises(ValueError):
        # overlap >= target would make step <= 0 (no progress).
        plan_chunks(duration_secs=2000.0, target_secs=900, overlap_secs=900)


# ---------------------------------------------------------------------------
# probe_duration_secs
# ---------------------------------------------------------------------------


def test_probe_duration_missing_file_raises(tmp_path):
    with pytest.raises(RuntimeError, match="missing"):
        probe_duration_secs(tmp_path / "nope.mp3")


def _fake_completed(stdout: str, returncode: int = 0):
    return subprocess.CompletedProcess(args=["ffprobe"], returncode=returncode, stdout=stdout)


def test_probe_duration_parses_ffprobe_json(tmp_path):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"fake")
    with patch(
        "app.services.fireworks_audio_chunking.subprocess.run",
        return_value=_fake_completed('{"format": {"duration": "3556.123"}}'),
    ):
        assert probe_duration_secs(src) == pytest.approx(3556.123)


def test_probe_duration_raises_on_non_positive_duration(tmp_path):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"fake")
    with patch(
        "app.services.fireworks_audio_chunking.subprocess.run",
        return_value=_fake_completed('{"format": {"duration": "0"}}'),
    ):
        with pytest.raises(RuntimeError, match="non-positive"):
            probe_duration_secs(src)


def test_probe_duration_raises_on_unparseable_output(tmp_path):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"fake")
    with patch(
        "app.services.fireworks_audio_chunking.subprocess.run",
        return_value=_fake_completed("not json at all"),
    ):
        with pytest.raises(RuntimeError, match="unparseable"):
            probe_duration_secs(src)


def test_probe_duration_raises_on_missing_format_key(tmp_path):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"fake")
    with patch(
        "app.services.fireworks_audio_chunking.subprocess.run",
        return_value=_fake_completed('{"streams": []}'),
    ):
        with pytest.raises(RuntimeError, match="unparseable"):
            probe_duration_secs(src)


def test_probe_duration_raises_on_ffprobe_failure(tmp_path):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"fake")
    with patch(
        "app.services.fireworks_audio_chunking.subprocess.run",
        side_effect=subprocess.CalledProcessError(
            returncode=1, cmd=["ffprobe"], stderr="invalid data"
        ),
    ):
        with pytest.raises(RuntimeError, match="ffprobe failed"):
            probe_duration_secs(src)


# ---------------------------------------------------------------------------
# stitch_responses
# ---------------------------------------------------------------------------


def _word(start, end, text="x", speaker="0"):
    return {"start": start, "end": end, "word": text, "speaker_id": speaker}


def _seg(start, end, text="x"):
    return {"start": start, "end": end, "text": text}


def test_stitch_empty_returns_empty():
    out = stitch_responses([], [])
    assert out == {"language": "unknown", "segments": [], "words": []}


def test_stitch_single_chunk_passes_through():
    chunks = [Chunk(index=0, start=0.0, end=900.0)]
    resp = {
        "language": "en",
        "segments": [_seg(1.0, 2.0, "hello")],
        "words": [_word(1.0, 1.5, "hello")],
    }
    out = stitch_responses([resp], chunks)
    assert out["language"] == "en"
    assert out["segments"] == [_seg(1.0, 2.0, "hello")]
    assert out["words"] == [_word(1.0, 1.5, "hello")]


def test_stitch_offsets_timestamps_to_whole_episode_time():
    chunks = [
        Chunk(index=0, start=0.0, end=900.0),
        Chunk(index=1, start=897.0, end=1500.0),
    ]
    resp_a = {
        "language": "en",
        "segments": [_seg(0.0, 100.0, "first")],
        "words": [_word(50.0, 50.5, "first")],
    }
    resp_b = {
        "language": "en",
        # Times in chunk B are local (start at 0).
        "segments": [_seg(100.0, 200.0, "second")],
        "words": [_word(150.0, 150.5, "second")],
    }
    out = stitch_responses([resp_a, resp_b], chunks)
    # Chunk B's timestamps should be shifted by chunk B's start (897s).
    assert out["words"][-1]["start"] == pytest.approx(897.0 + 150.0)
    assert out["words"][-1]["end"] == pytest.approx(897.0 + 150.5)
    assert out["segments"][-1]["start"] == pytest.approx(897.0 + 100.0)
    assert out["segments"][-1]["end"] == pytest.approx(897.0 + 200.0)


def test_stitch_drops_duplicate_words_at_seam():
    """If both chunks have words in the overlap window, midpoint split keeps each side."""
    chunks = [
        Chunk(index=0, start=0.0, end=900.0),
        Chunk(index=1, start=897.0, end=1800.0),
    ]
    # Overlap region: 897..900 (whole-file time). Midpoint = 898.5.
    # Chunk A (local time = whole-file time, since start=0):
    resp_a = {
        "language": "en",
        "segments": [],
        # Two words near the seam: one before midpoint, one after.
        "words": [
            _word(896.0, 896.5, "before"),
            _word(897.5, 898.0, "seam_a_kept"),  # < 898.5 -> A keeps it
            _word(899.0, 899.5, "seam_a_dropped"),  # >= 898.5 -> A drops it
        ],
    }
    # Chunk B local time = whole_time - 897. So whole-file equivalents are:
    #   local 0.5..1.0 -> 897.5..898.0 (< 898.5) -> B drops it
    #   local 2.0..2.5 -> 899.0..899.5 (>= 898.5) -> B keeps it
    resp_b = {
        "language": "en",
        "segments": [],
        "words": [
            _word(0.5, 1.0, "seam_b_dropped"),
            _word(2.0, 2.5, "seam_b_kept"),
            _word(10.0, 10.5, "after"),
        ],
    }
    out = stitch_responses([resp_a, resp_b], chunks)
    texts = [w["word"] for w in out["words"]]
    assert texts == ["before", "seam_a_kept", "seam_b_kept", "after"]


def test_stitch_picks_chunk0_language_when_uniform():
    chunks = [
        Chunk(index=0, start=0.0, end=900.0),
        Chunk(index=1, start=897.0, end=1500.0),
    ]
    out = stitch_responses(
        [
            {"language": "en", "segments": [], "words": []},
            {"language": "en", "segments": [], "words": []},
        ],
        chunks,
    )
    assert out["language"] == "en"


def test_stitch_majority_vote_when_languages_disagree():
    chunks = [
        Chunk(index=0, start=0.0, end=900.0),
        Chunk(index=1, start=897.0, end=1500.0),
        Chunk(index=2, start=1497.0, end=2100.0),
    ]
    out = stitch_responses(
        [
            {"language": "en", "segments": [], "words": []},
            {"language": "de", "segments": [], "words": []},
            {"language": "en", "segments": [], "words": []},
        ],
        chunks,
    )
    assert out["language"] == "en"


def test_stitch_rejects_length_mismatch():
    with pytest.raises(ValueError):
        stitch_responses(
            [{"language": "en", "segments": [], "words": []}],
            [
                Chunk(index=0, start=0.0, end=900.0),
                Chunk(index=1, start=897.0, end=1500.0),
            ],
        )


def test_stitch_handles_missing_optional_keys():
    """A response dict without `segments` or `words` keys should not crash."""
    chunks = [Chunk(index=0, start=0.0, end=900.0)]
    out = stitch_responses([{"language": "en"}], chunks)
    assert out == {"language": "en", "segments": [], "words": []}
