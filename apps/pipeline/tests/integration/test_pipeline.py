"""
Integration tests — PRD-01 §12

Requires a running test PostgreSQL database (see docker-compose.test.yml).
Uses a real 10-second audio fixture for end-to-end pipeline testing.
"""
import pytest
from pathlib import Path

FIXTURE_AUDIO = Path(__file__).parent.parent / "fixtures" / "sample.mp3"


@pytest.mark.skipif(
    not FIXTURE_AUDIO.exists(),
    reason="Audio fixture not present — run: make test-integration",
)
class TestFullPipeline:
    def test_transcribe_produces_segments(self):
        """Full pipeline: audio → transcription → segments in DB."""
        # TODO: implement with test DB session
        pytest.skip("Integration test stub — implement with test DB session")

    def test_diarization_failure_preserves_segments(self):
        """If pyannote fails, segments are still written with speaker_label=NULL."""
        pytest.skip("Integration test stub — mock pyannote to raise")

    def test_disk_full_during_archive(self):
        """DISK_FULL error class set, raw file not deleted."""
        pytest.skip("Integration test stub — mock ffmpeg archival to raise OSError 28")
