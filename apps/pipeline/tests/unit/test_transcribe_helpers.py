"""Unit tests for app.tasks.transcribe_helpers (#556)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.tasks.transcribe_helpers import (
    compute_fireworks_cost,
    estimate_fireworks_usage,
    persist_transcription_artifacts,
    remove_artifacts,
)


class TestEstimateFireworksUsage:
    def test_uses_max_segment_end_when_available(self):
        segments = [
            {"end": 10.0},
            {"end": 42.5},
            {"end": 5.0},
        ]
        assert estimate_fireworks_usage(segments, fallback_duration_secs=999) == 42.5

    def test_falls_back_to_episode_duration_when_segments_empty(self):
        assert estimate_fireworks_usage([], fallback_duration_secs=120) == 120.0

    def test_falls_back_when_no_valid_end_values(self):
        # All end values missing / zero -> fall back
        segments = [{"end": 0.0}, {"end": None}]
        assert estimate_fireworks_usage(segments, fallback_duration_secs=60) == 60.0

    def test_returns_zero_when_nothing_available(self):
        assert estimate_fireworks_usage([], fallback_duration_secs=None) == 0.0

    def test_skips_invalid_end_values(self):
        # Non-numeric end should be skipped, still pick max of valid ones.
        segments = [{"end": "bad"}, {"end": 12.0}, {"end": object()}]
        assert estimate_fireworks_usage(segments, fallback_duration_secs=100) == 12.0


class TestComputeFireworksCost:
    def test_rounds_minutes_to_three_decimals_and_cost_to_four(self):
        minutes, cost = compute_fireworks_cost(audio_secs=90.0, configured_rate_usd_per_minute=0.01)
        assert minutes == 1.5
        assert cost == 0.015

    def test_zero_audio_returns_zero(self):
        assert compute_fireworks_cost(0.0, 0.05) == (0.0, 0.0)

    def test_negative_audio_returns_zero(self):
        # audio_secs > 0 gate means negatives short-circuit to 0.
        assert compute_fireworks_cost(-5.0, 0.05) == (0.0, 0.0)


class TestRemoveArtifacts:
    def test_unlinks_existing_files(self, tmp_path: Path):
        a = tmp_path / "a.json"
        b = tmp_path / "b.json"
        a.write_text("{}")
        b.write_text("{}")
        missing = tmp_path / "missing.json"  # never created

        remove_artifacts(a, b, missing)

        assert not a.exists()
        assert not b.exists()
        # No crash for missing file.

    def test_swallows_unlink_errors(self, tmp_path: Path):
        a = tmp_path / "a.json"
        a.write_text("{}")

        with patch.object(Path, "unlink", side_effect=OSError("locked")):
            # Should not raise.
            remove_artifacts(a)


class TestPersistTranscriptionArtifacts:
    def test_writes_both_artifacts_and_returns_paths(self, tmp_path: Path):
        aligned_path, fireworks_path = persist_transcription_artifacts(
            transcript_dir=str(tmp_path),
            episode_id="ep-1",
            aligned_result={"segments": [1, 2]},
            fireworks_result={"words": []},
        )

        assert aligned_path == tmp_path / "ep-1.whisperx.json"
        assert fireworks_path == tmp_path / "ep-1.fireworks.json"
        assert json.loads(aligned_path.read_text()) == {"segments": [1, 2]}
        assert json.loads(fireworks_path.read_text()) == {"words": []}

    def test_only_aligned_side(self, tmp_path: Path):
        aligned_path, fireworks_path = persist_transcription_artifacts(
            transcript_dir=str(tmp_path),
            episode_id="ep-2",
            aligned_result={"a": 1},
            fireworks_result=None,
        )
        assert aligned_path.exists()
        assert not fireworks_path.exists()

    def test_only_fireworks_side(self, tmp_path: Path):
        aligned_path, fireworks_path = persist_transcription_artifacts(
            transcript_dir=str(tmp_path),
            episode_id="ep-3",
            aligned_result=None,
            fireworks_result={"b": 2},
        )
        assert not aligned_path.exists()
        assert fireworks_path.exists()

    def test_creates_transcript_dir_if_missing(self, tmp_path: Path):
        target = tmp_path / "nested" / "dir"
        persist_transcription_artifacts(
            transcript_dir=str(target),
            episode_id="ep-4",
            aligned_result={"x": True},
            fireworks_result=None,
        )
        assert (target / "ep-4.whisperx.json").exists()
