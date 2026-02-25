"""
Unit tests for majority-overlap speaker alignment — PRD-01 §5.5, PRD-01 §12
"""
import pytest

from app.services.alignment import assign_speakers, _overlap


class TestOverlap:
    def test_no_overlap(self):
        assert _overlap(0, 5, 6, 10) == 0.0

    def test_adjacent_no_overlap(self):
        assert _overlap(0, 5, 5, 10) == 0.0

    def test_full_overlap(self):
        assert _overlap(0, 10, 0, 10) == 10.0

    def test_partial_overlap(self):
        assert _overlap(0, 10, 5, 15) == 5.0

    def test_contained(self):
        assert _overlap(2, 8, 0, 10) == 6.0


class TestAssignSpeakers:
    def test_simple_single_speaker(self):
        segs = [{"id": 1, "start": 0.0, "end": 10.0}]
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 10.0}]
        result = assign_speakers(segs, diar)
        assert result == {1: "SPEAKER_00"}

    def test_majority_overlap_wins(self):
        # Whisper segment spans a speaker boundary — SPEAKER_00 has more overlap
        segs = [{"id": 1, "start": 0.0, "end": 10.0}]
        diar = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 7.0},  # 7s overlap
            {"speaker": "SPEAKER_01", "start": 7.0, "end": 12.0},  # 3s overlap
        ]
        result = assign_speakers(segs, diar)
        assert result[1] == "SPEAKER_00"

    def test_tie_broken_by_earlier_start(self):
        # Equal overlap — earlier-starting speaker wins (PRD-01 §5.5)
        segs = [{"id": 1, "start": 0.0, "end": 10.0}]
        diar = [
            {"speaker": "SPEAKER_01", "start": 0.0, "end": 5.0},  # 5s overlap
            {"speaker": "SPEAKER_00", "start": 5.0, "end": 10.0},  # 5s overlap, later start
        ]
        result = assign_speakers(segs, diar)
        assert result[1] == "SPEAKER_01"  # Earlier start wins

    def test_multiple_segments(self):
        segs = [
            {"id": 1, "start": 0.0, "end": 5.0},
            {"id": 2, "start": 5.0, "end": 10.0},
        ]
        diar = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
            {"speaker": "SPEAKER_01", "start": 5.0, "end": 10.0},
        ]
        result = assign_speakers(segs, diar)
        assert result[1] == "SPEAKER_00"
        assert result[2] == "SPEAKER_01"

    def test_no_diarization_segments(self):
        segs = [{"id": 1, "start": 0.0, "end": 5.0}]
        result = assign_speakers(segs, [])
        assert 1 not in result  # No assignment made

    def test_zero_duration_segment(self):
        segs = [{"id": 1, "start": 5.0, "end": 5.0}]  # Zero duration
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 10.0}]
        result = assign_speakers(segs, diar)
        assert result[1] == "SPEAKER_00"  # Falls back to default
