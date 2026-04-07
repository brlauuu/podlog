"""Unit tests for app.services.fireworks_audio."""

from app.services.fireworks_audio import (
    diarization_segments_from_transcription,
    assign_segment_speakers_from_words,
)


def test_diarization_segments_from_transcription_merges_adjacent_words():
    raw = {
        "words": [
            {"speaker_id": "0", "start": 0.0, "end": 0.4},
            {"speaker_id": "0", "start": 0.4, "end": 0.8},
            {"speaker_id": "1", "start": 0.9, "end": 1.2},
        ]
    }

    segs = diarization_segments_from_transcription(raw)

    assert segs == [
        {"speaker": "SPEAKER_00", "start": 0.0, "end": 0.8},
        {"speaker": "SPEAKER_01", "start": 0.9, "end": 1.2},
    ]


def test_assign_segment_speakers_from_words_majority_overlap():
    raw = {
        "words": [
            {"speaker_id": "0", "start": 0.0, "end": 1.0},
            {"speaker_id": "1", "start": 1.0, "end": 2.0},
            {"speaker_id": "1", "start": 2.0, "end": 3.0},
        ]
    }
    transcript_segments = [
        {"id": 1, "start": 0.0, "end": 1.5},
        {"id": 2, "start": 1.5, "end": 3.0},
    ]

    mapping = assign_segment_speakers_from_words(transcript_segments, raw)

    assert mapping[1] == "SPEAKER_00"
    assert mapping[2] == "SPEAKER_01"
