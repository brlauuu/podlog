"""
Integration tests — PRD-01 §12

Requires a running test PostgreSQL database (see docker-compose.test.yml).
Set TEST_DATABASE_URL env var before running.

Uses a real 10-second audio fixture and mocked ML services.
"""
import shutil
import uuid
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.models import Episode, Segment
from app.services.fireworks_audio import FireworksTranscriptionError

FIXTURE_AUDIO = Path(__file__).parent.parent / "fixtures" / "sample.mp3"


@pytest.mark.skipif(
    not FIXTURE_AUDIO.exists(),
    reason="Audio fixture not present — run: make test-integration",
)
class TestTranscription:
    """Tests for the transcribe task with mocked Whisper."""

    MOCK_SEGMENTS = [
        {"start": 0.0, "end": 3.5, "text": "Hello this is a test."},
        {"start": 3.5, "end": 7.0, "text": "We are testing the pipeline."},
        {"start": 7.0, "end": 10.0, "text": "This is the final segment."},
    ]

    def test_transcribe_writes_segments_to_db(self, db_session, sample_episode, tmp_path):
        """Full transcription: audio → mock Whisper → segments in DB."""
        # Set up the episode with a real audio file
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "transcribing"
        db_session.flush()

        # Mock Whisper to return known segments, mock ffmpeg conversion, mock diarize chain
        with patch("app.tasks.transcribe._convert_to_wav") as mock_convert, \
             patch("app.services.whisper.transcribe", return_value=(self.MOCK_SEGMENTS, "en", None)), \
             patch("app.tasks.transcribe._unload_whisper"), \
             patch("app.tasks.transcribe.SessionLocal", return_value=db_session), \
             patch("app.tasks.diarize.diarize_episode") as mock_diarize:

            mock_diarize.delay = MagicMock()

            from app.tasks.transcribe import transcribe_episode
            transcribe_episode(sample_episode.id)

        segments = (
            db_session.query(Segment)
            .filter(Segment.episode_id == sample_episode.id)
            .order_by(Segment.start_time)
            .all()
        )
        assert len(segments) == 3
        assert segments[0].text == "Hello this is a test."
        assert segments[1].start_time == 3.5
        assert segments[2].end_time == 10.0
        assert all(s.speaker_label is None for s in segments)

        # Check episode was updated
        db_session.refresh(sample_episode)
        assert sample_episode.language == "en"

    def test_oom_marks_episode_failed(self, db_session, sample_episode, tmp_path):
        """MemoryError during transcription → episode.status='failed', error_class='OOM'."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "transcribing"
        db_session.flush()

        with patch("app.tasks.transcribe._convert_to_wav"), \
             patch("app.services.whisper.transcribe", side_effect=MemoryError("CUDA OOM")), \
             patch("app.tasks.transcribe._unload_whisper"), \
             patch("app.tasks.transcribe.SessionLocal", return_value=db_session):

            from app.tasks.transcribe import transcribe_episode
            transcribe_episode(sample_episode.id)

        db_session.refresh(sample_episode)
        assert sample_episode.status == "failed"
        assert sample_episode.error_class == "OOM"

    def test_fireworks_transient_failure_then_recovery_is_idempotent(
        self, db_session, sample_episode, tmp_path
    ):
        """Transient Fireworks failure retries, then successful rerun writes a clean segment set."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "transcribing"
        sample_episode.retry_count = 0
        sample_episode.retry_max = 3
        db_session.flush()

        ok_segments = [
            {"start": 0.0, "end": 2.0, "text": "One"},
            {"start": 2.0, "end": 4.0, "text": "Two"},
        ]

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                side_effect=[
                    FireworksTranscriptionError(
                        "Fireworks API HTTP 429",
                        error_class="TRANSIENT_NETWORK",
                        retryable=True,
                        status_code=429,
                    ),
                    (ok_segments, "en", {"segments": ok_segments, "words": []}),
                ],
            ),
            patch(
                "app.tasks.transcribe.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_api_key": "fw_test",
                    "fireworks_audio_base_url": "https://audio-turbo.api.fireworks.ai",
                    "fireworks_stt_model": "whisper-v3-large",
                    "fireworks_stt_diarize": True,
                    "fireworks_stt_cost_per_minute_usd": 0.006,
                },
            ),
            patch("app.tasks.transcribe.SessionLocal", return_value=db_session),
            patch("app.tasks.transcribe.settings") as mock_settings,
            patch("app.tasks.transcribe.job_queue.enqueue") as mock_enqueue,
        ):
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.transcript_dir = str(tmp_path / "transcripts")
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            # First attempt -> retry scheduled, no segments persisted.
            transcribe_episode(sample_episode.id)
            db_session.refresh(sample_episode)
            assert sample_episode.status == "pending"
            assert sample_episode.retry_count == 1
            assert sample_episode.error_class == "TRANSIENT_NETWORK"
            assert (
                db_session.query(Segment)
                .filter(Segment.episode_id == sample_episode.id)
                .count()
                == 0
            )

            # Second attempt -> success, clean final state.
            transcribe_episode(sample_episode.id)
            db_session.refresh(sample_episode)
            assert sample_episode.status == "diarizing"
            assert sample_episode.language == "en"
            segments = (
                db_session.query(Segment)
                .filter(Segment.episode_id == sample_episode.id)
                .order_by(Segment.start_time)
                .all()
            )
            assert len(segments) == 2
            assert [s.text for s in segments] == ["One", "Two"]

            assert mock_enqueue.call_count == 2
            first_call = mock_enqueue.call_args_list[0]
            second_call = mock_enqueue.call_args_list[1]
            assert first_call.args[2] == "transcribe"
            assert first_call.kwargs["retry_at"] is not None
            assert second_call.args[2] == "diarize"


class TestDiarization:
    """Tests for the diarize task with mocked pyannote."""

    def test_successful_diarization_assigns_speakers(self, db_session, sample_episode, tmp_path):
        """Diarization assigns speaker labels to existing segments."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "diarizing"
        db_session.flush()

        # Pre-populate segments (as transcription would have done)
        for i, (start, end, text) in enumerate([
            (0.0, 5.0, "First speaker says hello."),
            (5.0, 10.0, "Second speaker responds."),
        ]):
            db_session.add(Segment(
                episode_id=sample_episode.id,
                start_time=start,
                end_time=end,
                text=text,
                speaker_label=None,
            ))
        db_session.flush()

        mock_diar_segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
            {"speaker": "SPEAKER_01", "start": 5.0, "end": 10.0},
        ]

        with patch("app.services.pyannote.diarize", return_value=mock_diar_segments), \
             patch("app.tasks.diarize.SessionLocal", return_value=db_session), \
             patch("app.tasks.archive.archive_episode") as mock_archive:

            mock_archive.delay = MagicMock()

            from app.tasks.diarize import diarize_episode
            diarize_episode(sample_episode.id)

        db_session.refresh(sample_episode)
        assert sample_episode.has_diarization is True
        assert sample_episode.diarization_error is None

        segments = (
            db_session.query(Segment)
            .filter(Segment.episode_id == sample_episode.id)
            .order_by(Segment.start_time)
            .all()
        )
        assert segments[0].speaker_label == "SPEAKER_00"
        assert segments[1].speaker_label == "SPEAKER_01"

    def test_diarization_failure_preserves_segments(self, db_session, sample_episode, tmp_path):
        """If pyannote fails, segments are still present with speaker_label=NULL."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "diarizing"
        db_session.flush()

        # Pre-populate segments
        db_session.add(Segment(
            episode_id=sample_episode.id,
            start_time=0.0,
            end_time=10.0,
            text="This segment should survive diarization failure.",
            speaker_label=None,
        ))
        db_session.flush()

        with patch("app.services.pyannote.diarize", side_effect=RuntimeError("Model load failed")), \
             patch("app.tasks.diarize.SessionLocal", return_value=db_session), \
             patch("app.tasks.archive.archive_episode") as mock_archive:

            mock_archive.delay = MagicMock()

            from app.tasks.diarize import diarize_episode
            diarize_episode(sample_episode.id)

        db_session.refresh(sample_episode)
        assert sample_episode.has_diarization is False
        assert "Model load failed" in sample_episode.diarization_error

        # Segments are preserved with NULL speaker
        segments = (
            db_session.query(Segment)
            .filter(Segment.episode_id == sample_episode.id)
            .all()
        )
        assert len(segments) == 1
        assert segments[0].speaker_label is None
        assert segments[0].text == "This segment should survive diarization failure."


class TestArchive:
    """Tests for the archive task with mocked ffmpeg."""

    def test_archive_writes_transcript_file(self, db_session, sample_episode, tmp_path):
        """Archive produces a .txt transcript and marks episode done."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "archiving"
        sample_episode.has_diarization = True
        db_session.flush()

        # Add segments with speaker labels
        db_session.add(Segment(
            episode_id=sample_episode.id,
            start_time=0.0,
            end_time=5.0,
            text="Hello from speaker zero.",
            speaker_label="SPEAKER_00",
        ))
        db_session.add(Segment(
            episode_id=sample_episode.id,
            start_time=5.0,
            end_time=10.0,
            text="And speaker one responds.",
            speaker_label="SPEAKER_01",
        ))
        db_session.flush()

        transcript_dir = tmp_path / "transcripts"
        archive_dir = tmp_path / "archive"

        with patch("app.tasks.archive.settings") as mock_settings, \
             patch("app.tasks.archive.SessionLocal", return_value=db_session), \
             patch("app.tasks.archive._compress_audio", return_value=archive_dir / f"{sample_episode.id}.mp3"):

            mock_settings.archive_audio = True
            mock_settings.transcript_dir = str(transcript_dir)

            from app.tasks.archive import archive_episode
            archive_episode(sample_episode.id)

        db_session.refresh(sample_episode)
        assert sample_episode.status == "done"
        assert sample_episode.processed_at is not None
        assert sample_episode.transcript_path is not None

        # Verify transcript content
        transcript = Path(sample_episode.transcript_path).read_text()
        assert "Hello from speaker zero." in transcript
        assert "SPEAKER_00" in transcript
        assert "SPEAKER_01" in transcript

    def test_disk_full_during_archive_preserves_raw(self, db_session, sample_episode, tmp_path):
        """DISK_FULL during ffmpeg compression: episode fails, raw file preserved."""
        audio_dest = tmp_path / f"{sample_episode.id}.mp3"
        shutil.copy(FIXTURE_AUDIO, audio_dest)
        sample_episode.audio_local_path = str(audio_dest)
        sample_episode.status = "archiving"
        db_session.flush()

        disk_full_error = OSError(28, "No space left on device")

        with patch("app.tasks.archive.settings") as mock_settings, \
             patch("app.tasks.archive.SessionLocal", return_value=db_session), \
             patch("app.tasks.archive._compress_audio", side_effect=disk_full_error):

            mock_settings.archive_audio = True

            from app.tasks.archive import archive_episode
            archive_episode(sample_episode.id)

        db_session.refresh(sample_episode)
        assert sample_episode.status == "failed"
        assert sample_episode.error_class == "DISK_FULL"
        # Raw file is preserved (not deleted)
        assert audio_dest.exists()


class TestFeedsListEndpoint:
    """Issue #455: GET /api/feeds must return feeds as JSON (id serialized as string)."""

    def test_list_feeds_returns_rows_with_string_id(self, db_session, sample_feed):
        from fastapi.testclient import TestClient

        from app.database import get_db
        from app.main import app

        app.dependency_overrides[get_db] = lambda: db_session
        try:
            client = TestClient(app)
            resp = client.get("/api/feeds")
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list) and len(body) >= 1
        feed = next(f for f in body if f["url"] == sample_feed.url)
        assert feed["id"] == sample_feed.id
        assert isinstance(feed["id"], str)


class TestDeleteEpisodeEndpoint:
    """Issue #454: DELETE /api/episodes/{id} removes a manually uploaded episode."""

    def test_delete_removes_row_cascades_children_and_cleans_files(
        self, db_session, tmp_path
    ):
        from fastapi.testclient import TestClient
        from unittest.mock import patch
        from app.database import get_db
        from app.main import app
        from app.models import Chunk, Episode, Segment, SpeakerName

        # Match the layout computed by Settings.audio_raw_dir / audio_archive_dir / transcript_dir
        raw_dir = tmp_path / "audio" / "raw"
        archive_dir = tmp_path / "audio" / "archive"
        transcript_dir = tmp_path / "transcripts"
        raw_dir.mkdir(parents=True)
        archive_dir.mkdir(parents=True)
        transcript_dir.mkdir(parents=True)

        episode = Episode(
            id=str(uuid.uuid4()),
            feed_id=None,
            guid=f"upload:test-{uuid.uuid4().hex[:8]}",
            title="Manual Upload",
            audio_url="local://sample.mp3",
            status="done",
        )
        db_session.add(episode)
        db_session.flush()

        seg = Segment(
            episode_id=episode.id, start_time=0.0, end_time=1.0, text="hello"
        )
        db_session.add(seg)
        db_session.flush()
        chunk = Chunk(
            episode_id=episode.id,
            start_time=0.0,
            end_time=1.0,
            text="hello",
            segment_ids=[seg.id],
        )
        db_session.add(chunk)
        db_session.add(
            SpeakerName(episode_id=episode.id, speaker_label="SPEAKER_00", display_name="Alice")
        )

        # On-disk artifacts
        audio_file = raw_dir / f"{episode.id}.mp3"
        audio_file.write_bytes(b"audio")
        archived_file = archive_dir / f"{episode.id}.mp3"
        archived_file.write_bytes(b"archived")
        transcript_file = transcript_dir / f"{episode.id}.txt"
        transcript_file.write_text("transcript")

        episode.audio_local_path = str(audio_file)
        episode.transcript_path = str(transcript_file)
        db_session.flush()

        app.dependency_overrides[get_db] = lambda: db_session
        try:
            with (
                patch("app.api.episodes.settings.data_dir", str(tmp_path)),
            ):
                client = TestClient(app)
                resp = client.delete(f"/api/episodes/{episode.id}")
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 204
        assert db_session.query(Episode).filter(Episode.id == episode.id).first() is None
        assert db_session.query(Segment).filter(Segment.episode_id == episode.id).count() == 0
        assert db_session.query(Chunk).filter(Chunk.episode_id == episode.id).count() == 0
        assert (
            db_session.query(SpeakerName).filter(SpeakerName.episode_id == episode.id).count() == 0
        )
        assert not audio_file.exists()
        assert not archived_file.exists()
        assert not transcript_file.exists()

    def test_delete_refuses_feed_linked_episode(self, db_session, sample_episode):
        from fastapi.testclient import TestClient

        from app.database import get_db
        from app.main import app
        from app.models import Episode

        assert sample_episode.feed_id is not None  # sanity

        app.dependency_overrides[get_db] = lambda: db_session
        try:
            client = TestClient(app)
            resp = client.delete(f"/api/episodes/{sample_episode.id}")
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 403
        assert db_session.query(Episode).filter(Episode.id == sample_episode.id).first() is not None
