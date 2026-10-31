"""
Unit tests for speaker alignment — PRD-01 §5.5, PRD-01 §12
Tests both word-level and segment-level (fallback) alignment.
"""
import pytest

from app.services.alignment import (
    assign_speakers,
    assign_speakers_wordlevel,
    _overlap,
)


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
    """Segment-level majority overlap (fallback)."""

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


class TestAssignSpeakersWordlevel:
    """Word-level speaker alignment with segment rebuilding."""

    def test_single_speaker_merges_all_words(self):
        """All words from one speaker should produce a single segment."""
        aligned = [
            {
                "start": 0.0, "end": 3.0, "text": "Hello world",
                "words": [
                    {"word": " Hello", "start": 0.0, "end": 1.0},
                    {"word": " world", "start": 1.0, "end": 2.0},
                ],
            },
        ]
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0}]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 1
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "Hello world"
        assert result[0]["start"] == 0.0
        assert result[0]["end"] == 2.0

    def test_speaker_transition_splits_segment(self):
        """A speaker change mid-segment should produce two rebuilt segments."""
        aligned = [
            {
                "start": 0.0, "end": 6.0,
                "text": "How are you I am fine",
                "words": [
                    {"word": " How", "start": 0.0, "end": 1.0},
                    {"word": " are", "start": 1.0, "end": 2.0},
                    {"word": " you", "start": 2.0, "end": 3.0},
                    {"word": " I", "start": 3.5, "end": 4.0},
                    {"word": " am", "start": 4.0, "end": 4.5},
                    {"word": " fine", "start": 4.5, "end": 5.5},
                ],
            },
        ]
        diar = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 3.2},
            {"speaker": "SPEAKER_01", "start": 3.2, "end": 6.0},
        ]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 2
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "How are you"
        assert result[1]["speaker"] == "SPEAKER_01"
        assert result[1]["text"] == "I am fine"

    def test_rapid_back_and_forth(self):
        """Multiple speaker transitions within a short span."""
        aligned = [
            {
                "start": 0.0, "end": 6.0,
                "text": "Yes No Maybe",
                "words": [
                    {"word": " Yes", "start": 0.0, "end": 1.0},
                    {"word": " No", "start": 2.0, "end": 3.0},
                    {"word": " Maybe", "start": 4.0, "end": 5.0},
                ],
            },
        ]
        diar = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5},
            {"speaker": "SPEAKER_01", "start": 1.5, "end": 3.5},
            {"speaker": "SPEAKER_00", "start": 3.5, "end": 6.0},
        ]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 3
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "Yes"
        assert result[1]["speaker"] == "SPEAKER_01"
        assert result[1]["text"] == "No"
        assert result[2]["speaker"] == "SPEAKER_00"
        assert result[2]["text"] == "Maybe"

    def test_multiple_whisperx_segments(self):
        """Words from multiple WhisperX segments are flattened and reassigned."""
        aligned = [
            {
                "start": 0.0, "end": 2.0, "text": "First",
                "words": [{"word": " First", "start": 0.0, "end": 1.0}],
            },
            {
                "start": 2.0, "end": 4.0, "text": "Second",
                "words": [{"word": " Second", "start": 2.0, "end": 3.0}],
            },
        ]
        diar = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5},
            {"speaker": "SPEAKER_01", "start": 1.5, "end": 4.0},
        ]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 2
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "First"
        assert result[1]["speaker"] == "SPEAKER_01"
        assert result[1]["text"] == "Second"

    def test_no_words_returns_empty(self):
        """Segments without word data should return empty list."""
        aligned = [{"start": 0.0, "end": 5.0, "text": "Hello"}]  # no "words" key
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0}]
        result = assign_speakers_wordlevel(aligned, diar)
        assert result == []

    def test_words_missing_timestamps_are_skipped(self):
        """Words without start/end timestamps are excluded."""
        aligned = [
            {
                "start": 0.0, "end": 3.0, "text": "A B",
                "words": [
                    {"word": " A", "start": 0.0, "end": 1.0},
                    {"word": " B"},  # missing timestamps
                    {"word": " C", "start": 2.0, "end": 3.0},
                ],
            },
        ]
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0}]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 1
        assert result[0]["text"] == "A C"

    def test_empty_diarization_defaults_to_speaker_00(self):
        """Words with no matching diarization segments default to SPEAKER_00."""
        aligned = [
            {
                "start": 0.0, "end": 2.0, "text": "Hello",
                "words": [{"word": " Hello", "start": 0.0, "end": 1.0}],
            },
        ]
        result = assign_speakers_wordlevel(aligned, [])
        assert len(result) == 1
        assert result[0]["speaker"] == "SPEAKER_00"

    def test_preserves_sentence_boundaries_same_speaker(self):
        """Multiple Whisper segments from the same speaker stay separate."""
        aligned = [
            {
                "start": 0.0, "end": 3.0, "text": "First sentence.",
                "words": [
                    {"word": " First", "start": 0.0, "end": 1.0},
                    {"word": " sentence.", "start": 1.0, "end": 2.5},
                ],
            },
            {
                "start": 3.0, "end": 6.0, "text": "Second sentence.",
                "words": [
                    {"word": " Second", "start": 3.0, "end": 4.0},
                    {"word": " sentence.", "start": 4.0, "end": 5.5},
                ],
            },
        ]
        diar = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 6.0}]
        result = assign_speakers_wordlevel(aligned, diar)

        assert len(result) == 2
        assert result[0]["text"] == "First sentence."
        assert result[0]["start"] == 0.0
        assert result[1]["text"] == "Second sentence."
        assert result[1]["start"] == 3.0
        assert result[0]["speaker"] == result[1]["speaker"] == "SPEAKER_00"


def _turn(speaker, start, end):
    return {"speaker": speaker, "start": start, "end": end}


def _sentence(start, words, step=1.0):
    """One aligned segment of one-second words starting at `start`."""
    ws = [{"word": f" {w}", "start": start + i * step, "end": start + (i + 1) * step - 0.1}
          for i, w in enumerate(words)]
    return {"start": ws[0]["start"], "end": ws[-1]["end"], "text": " ".join(words), "words": ws}


class TestMinorSpeakers:
    """#1093: diarization slivers (a label holding one word) are absorbed."""

    def test_one_word_sliver_inside_a_turn_is_absorbed(self):
        # 400 s of host, with pyannote giving one word mid-sentence to a third label.
        aligned = [_sentence(i * 10.0, [f"w{i}_{j}" for j in range(10)]) for i in range(40)]
        diar = [_turn("SPEAKER_00", 0.0, 123.0), _turn("SPEAKER_07", 123.0, 123.95),
                _turn("SPEAKER_00", 123.95, 200.0), _turn("SPEAKER_01", 200.0, 400.0)]
        result = assign_speakers_wordlevel(aligned, diar)

        assert {r["speaker"] for r in result} == {"SPEAKER_00", "SPEAKER_01"}
        # The sentence the sliver sat in comes back whole, not split around it.
        assert any(r["text"].startswith("w12_0") and "w12_3" in r["text"] and "w12_9" in r["text"]
                   for r in result)

    def test_a_sliver_with_a_sentence_of_its_own_is_kept(self):
        """A pre-roll or jingle voice: left for slot assignment's Other card (PRD-04)."""
        aligned = [_sentence(0.0, ["Plazma.", "Ljubav", "u", "svakom", "kadru."])] + [
            _sentence(10.0 + i * 10.0, [f"w{i}_{j}" for j in range(10)]) for i in range(30)
        ]
        diar = [_turn("SPEAKER_04", 0.0, 5.0), _turn("SPEAKER_00", 5.0, 400.0)]
        result = assign_speakers_wordlevel(aligned, diar)
        assert result[0]["text"].startswith("Plazma.") and result[0]["speaker"] == "SPEAKER_04"

    def test_a_brief_guest_in_a_long_episode_is_kept(self):
        """20 s is above the absolute floor, however small its share."""
        aligned = [_sentence(i * 10.0, [f"w{i}_{j}" for j in range(10)]) for i in range(100)]
        diar = [_turn("SPEAKER_00", 0.0, 500.0), _turn("SPEAKER_02", 500.0, 520.0),
                _turn("SPEAKER_00", 520.0, 1000.0)]
        result = assign_speakers_wordlevel(aligned, diar)
        assert "SPEAKER_02" in {r["speaker"] for r in result}

    def test_a_short_speaker_in_a_short_recording_is_kept(self):
        """Under 15 s, but a real share of a 60 s clip."""
        aligned = [_sentence(i * 10.0, [f"w{i}_{j}" for j in range(10)]) for i in range(6)]
        diar = [_turn("SPEAKER_00", 0.0, 50.0), _turn("SPEAKER_01", 50.0, 60.0)]
        result = assign_speakers_wordlevel(aligned, diar)
        assert {r["speaker"] for r in result} == {"SPEAKER_00", "SPEAKER_01"}
