"""Unit tests for app.services.fireworks_audio."""
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services.fireworks_audio import (
    FireworksTranscriptionError,
    _classify_http_error,
    diarization_segments_from_transcription,
    assign_segment_speakers_from_words,
    rebuild_segments_from_words,
    transcribe,
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


def _make_raw(words: list[dict], segments: list[dict] | None = None) -> dict:
    """Helper to build a minimal Fireworks response dict for tests."""
    return {"words": words, "segments": segments or [{"start": 0.0, "end": 999.0}]}


class TestRebuildSegmentsFromWords:
    def test_basic_two_speakers(self):
        raw = _make_raw(
            words=[
                {"word": "Hello", "start": 0.0, "end": 0.5, "speaker_id": "0"},
                {"word": "world", "start": 0.5, "end": 1.0, "speaker_id": "0"},
                {"word": "Hi", "start": 1.1, "end": 1.5, "speaker_id": "1"},
                {"word": "there", "start": 1.5, "end": 2.0, "speaker_id": "1"},
            ],
            segments=[{"start": 0.0, "end": 2.0}],
        )
        result = rebuild_segments_from_words(raw)
        assert len(result) == 2
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "Hello world"
        assert result[0]["start"] == 0.0
        assert result[0]["end"] == 1.0
        assert result[1]["speaker"] == "SPEAKER_01"
        assert result[1]["text"] == "Hi there"

    def test_segment_boundary_splits_same_speaker(self):
        """Same speaker across two Fireworks segments → two DB segments."""
        raw = _make_raw(
            words=[
                {"word": "First", "start": 0.0, "end": 0.5, "speaker_id": "0"},
                {"word": "sentence.", "start": 0.5, "end": 1.0, "speaker_id": "0"},
                {"word": "Second", "start": 1.1, "end": 1.5, "speaker_id": "0"},
                {"word": "sentence.", "start": 1.5, "end": 2.0, "speaker_id": "0"},
            ],
            segments=[
                {"start": 0.0, "end": 1.0},
                {"start": 1.0, "end": 2.0},
            ],
        )
        result = rebuild_segments_from_words(raw)
        assert len(result) == 2
        assert result[0]["text"] == "First sentence."
        assert result[1]["text"] == "Second sentence."
        assert result[0]["speaker"] == result[1]["speaker"] == "SPEAKER_00"

    def test_speaker_change_within_segment(self):
        """Speaker changes mid-sentence → split within the same Fireworks segment."""
        raw = _make_raw(
            words=[
                {"word": "Yes", "start": 0.0, "end": 0.4, "speaker_id": "0"},
                {"word": "but", "start": 0.4, "end": 0.7, "speaker_id": "1"},
                {"word": "actually", "start": 0.7, "end": 1.0, "speaker_id": "1"},
            ],
            segments=[{"start": 0.0, "end": 1.0}],
        )
        result = rebuild_segments_from_words(raw)
        assert len(result) == 2
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "Yes"
        assert result[1]["speaker"] == "SPEAKER_01"
        assert result[1]["text"] == "but actually"

    def test_returns_empty_when_no_words(self):
        raw = _make_raw(words=[])
        assert rebuild_segments_from_words(raw) == []

    def test_returns_empty_when_no_speaker_ids(self):
        raw = _make_raw(
            words=[
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0},
            ]
        )
        assert rebuild_segments_from_words(raw) == []

    def test_propagates_speaker_to_unlabeled_words(self):
        """Words without speaker_id should inherit from adjacent labeled words."""
        raw = _make_raw(
            words=[
                {"word": "Hello", "start": 0.0, "end": 0.5, "speaker_id": "0"},
                {"word": "world", "start": 0.5, "end": 1.0},  # no speaker_id
            ]
        )
        result = rebuild_segments_from_words(raw)
        assert len(result) == 1
        assert result[0]["speaker"] == "SPEAKER_00"
        assert result[0]["text"] == "Hello world"

    def test_normalizes_speaker_ids(self):
        """Numeric speaker IDs like "0", "1" should be normalized to SPEAKER_00."""
        raw = _make_raw(
            words=[{"word": "Test", "start": 0.0, "end": 0.5, "speaker_id": "2"}]
        )
        result = rebuild_segments_from_words(raw)
        assert result[0]["speaker"] == "SPEAKER_02"


def test_classify_http_error_marks_429_and_5xx_as_retryable():
    assert _classify_http_error(429) == ("TRANSIENT_NETWORK", True)
    assert _classify_http_error(500) == ("TRANSIENT_NETWORK", True)
    assert _classify_http_error(503) == ("TRANSIENT_NETWORK", True)


def test_classify_http_error_marks_4xx_as_http_access_retryable():
    assert _classify_http_error(400) == ("HTTP_ACCESS", True)
    assert _classify_http_error(401) == ("HTTP_ACCESS", True)
    assert _classify_http_error(403) == ("HTTP_ACCESS", True)


def test_transcribe_wraps_429_as_retryable(tmp_path: Path):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"fake-audio")

    req = httpx.Request("POST", "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions")
    resp = httpx.Response(429, request=req)

    with patch("app.services.fireworks_audio.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.post.side_effect = httpx.HTTPStatusError(
            "Too many requests", request=req, response=resp
        )
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with pytest.raises(FireworksTranscriptionError) as excinfo:
            transcribe(
                str(audio_path),
                api_key="fw_test",
                audio_base_url="https://audio-turbo.api.fireworks.ai",
                model_name="whisper-v3-large",
                diarize=True,
            )

    exc = excinfo.value
    assert exc.error_class == "TRANSIENT_NETWORK"
    assert exc.retryable is True
    assert exc.status_code == 429
