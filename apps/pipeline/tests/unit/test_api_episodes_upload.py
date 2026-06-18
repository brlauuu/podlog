"""Unit tests for app.api.episodes upload + _remove_episode_files helpers (#822).

Existing test_api.py covers the GET/DELETE happy paths. This file focuses
on the upload error branches and the file-cleanup helper that together make
up the bulk of the previously-uncovered range.
"""
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.api import episodes as api_episodes
from app.config import settings
from app.database import get_db
from app.main import app


client = TestClient(app)


class TestUploadAudio:
    def _override_db(self, db):
        app.dependency_overrides[get_db] = lambda: db

    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_rejects_filename_with_unsupported_extension(self):
        db = MagicMock()
        self._override_db(db)
        resp = client.post(
            "/api/episodes/upload",
            files={"file": ("foo.exe", BytesIO(b"binary"), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "Unsupported file type" in resp.json()["detail"]

    def test_returns_507_when_disk_low(self):
        db = MagicMock()
        self._override_db(db)
        # Patch disk_usage to report less free space than the configured headroom.
        with patch("app.api.episodes.shutil.disk_usage") as mock_du:
            mock_du.return_value = MagicMock(free=0)
            resp = client.post(
                "/api/episodes/upload",
                files={"file": ("clip.mp3", BytesIO(b"x" * 10), "audio/mpeg")},
            )
        assert resp.status_code == 507
        assert "disk" in resp.json()["detail"].lower()

    def test_save_failure_rolls_back_and_returns_507(self):
        db = MagicMock()
        def _populate_id(obj):
            obj.id = "ep-fail"
            obj.audio_local_path = None
        db.refresh.side_effect = _populate_id
        self._override_db(db)
        with (
            patch("app.api.episodes.shutil.disk_usage") as mock_du,
            patch("app.api.episodes.Path.mkdir"),
            patch("app.api.episodes.open", side_effect=OSError("disk write failed")),
        ):
            mock_du.return_value = MagicMock(free=10**12)
            resp = client.post(
                "/api/episodes/upload",
                files={"file": ("clip.mp3", BytesIO(b"x" * 10), "audio/mpeg")},
            )
        assert resp.status_code == 507
        assert "Failed to save file" in resp.json()["detail"]
        # Rollback was called on the session.
        db.rollback.assert_called_once()


class TestRemoveEpisodeFiles:
    """Cover the safety/sweep behavior of _remove_episode_files (#822)."""

    def _setup_dirs(self, tmp_path: Path) -> tuple[Path, Path, Path]:
        # audio_raw_dir, audio_archive_dir, transcript_dir are @property
        # getters off settings.data_dir. Building under that root cascades.
        raw = tmp_path / "audio" / "raw"
        archive = tmp_path / "audio" / "archive"
        transcripts = tmp_path / "transcripts"
        raw.mkdir(parents=True)
        archive.mkdir(parents=True)
        transcripts.mkdir(parents=True)
        return raw, archive, transcripts

    def _override_settings(self, stack: ExitStack, raw: Path, archive: Path, transcripts: Path):
        # raw is <tmp>/audio/raw — its grandparent is the data_dir.
        data_dir = raw.parent.parent
        stack.enter_context(patch.object(settings, "data_dir", str(data_dir)))

    def test_unlinks_known_audio_and_transcript_paths(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        audio = raw / "ep1.mp3"
        audio.write_bytes(b"audio")
        transcript = transcripts / "ep1.json"
        transcript.write_text("{}")
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            api_episodes._remove_episode_files("ep1", str(audio), str(transcript))
        assert not audio.exists()
        assert not transcript.exists()

    def test_skips_paths_outside_allowed_roots(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        # File OUTSIDE the configured roots — must not be deleted.
        outside = tmp_path / "outside"
        outside.mkdir()
        sensitive = outside / "secret.mp3"
        sensitive.write_bytes(b"do not delete")
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            api_episodes._remove_episode_files("evil", str(sensitive), None)
        # Sensitive file untouched.
        assert sensitive.exists()
        assert sensitive.read_bytes() == b"do not delete"

    def test_handles_missing_files_silently(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        nonexistent = raw / "vanished.mp3"
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            api_episodes._remove_episode_files("ep", str(nonexistent), None)
        # No exception — function used missing_ok=True.

    def test_sweeps_orphan_files_in_raw_by_episode_id(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        # Multiple files with the episode_id prefix in raw/.
        f1 = raw / "ep42.mp3"
        f1.write_bytes(b"a")
        f2 = raw / "ep42.opus"
        f2.write_bytes(b"b")
        # Unrelated file — must NOT be deleted.
        unrelated = raw / "other.mp3"
        unrelated.write_bytes(b"keep")
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            api_episodes._remove_episode_files("ep42", None, None)
        assert not f1.exists()
        assert not f2.exists()
        assert unrelated.exists()

    def test_sweeps_archive_mp3_by_episode_id(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        archived = archive / "ep77.mp3"
        archived.write_bytes(b"archived")
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            api_episodes._remove_episode_files("ep77", None, None)
        assert not archived.exists()

    def test_handles_oserror_during_unlink_gracefully(self, tmp_path):
        raw, archive, transcripts = self._setup_dirs(tmp_path)
        audio = raw / "ep5.mp3"
        audio.write_bytes(b"x")
        with ExitStack() as _stack:
            self._override_settings(_stack, raw, archive, transcripts)
            _stack.enter_context(patch("pathlib.Path.unlink", side_effect=OSError("denied")))
            # Should swallow the error and continue.
            api_episodes._remove_episode_files("ep5", str(audio), None)
