"""Unit tests for app.services.backup_files (#687)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import app.services.backup_files as svc


def _seed_backups(root: Path) -> None:
    (root / "db" / "daily").mkdir(parents=True)
    (root / "db" / "weekly").mkdir(parents=True)
    (root / "db" / "monthly").mkdir(parents=True)
    (root / "audio" / "2026-05-09").mkdir(parents=True)
    (root / "audio" / "2026-05-10").mkdir(parents=True)

    (root / "db" / "daily" / "podlog-2026-05-10.dump").write_bytes(b"d" * 16)
    (root / "db" / "weekly" / "podlog-2026-05-10.dump").write_bytes(b"w" * 16)
    (root / "db" / "monthly" / "podlog-2026-05-01.dump").write_bytes(b"m" * 16)
    (root / "audio" / "2026-05-09" / "ep1.opus").write_bytes(b"a" * 16)
    (root / "audio" / "2026-05-10" / "ep1.opus").write_bytes(b"a" * 16)


@pytest.fixture
def fake_backups(tmp_path: Path):
    _seed_backups(tmp_path)
    with (
        patch.object(svc, "_BACKUPS_ROOT", tmp_path),
        patch.object(svc, "_DB_ROOT", tmp_path / "db"),
        patch.object(svc, "_AUDIO_ROOT", tmp_path / "audio"),
        patch.object(svc, "_LAST_RUN_FILE", tmp_path / ".last_run"),
    ):
        yield tmp_path


class TestDeleteDbDump:
    def test_deletes_daily(self, fake_backups: Path):
        target = fake_backups / "db" / "daily" / "podlog-2026-05-10.dump"
        assert target.exists()
        svc.delete_db_dump("daily", "podlog-2026-05-10.dump")
        assert not target.exists()

    def test_deletes_weekly_without_affecting_daily(self, fake_backups: Path):
        # Real backups would hardlink across tiers; the test fixture uses
        # independent files, but the unlink semantics are the same — only
        # the named entry is removed.
        svc.delete_db_dump("weekly", "podlog-2026-05-10.dump")
        assert not (fake_backups / "db" / "weekly" / "podlog-2026-05-10.dump").exists()
        assert (fake_backups / "db" / "daily" / "podlog-2026-05-10.dump").exists()

    def test_rejects_unknown_tier(self, fake_backups: Path):
        with pytest.raises(ValueError, match="tier"):
            svc.delete_db_dump("hourly", "podlog-2026-05-10.dump")

    def test_rejects_filename_without_extension(self, fake_backups: Path):
        with pytest.raises(ValueError, match="filename"):
            svc.delete_db_dump("daily", "podlog-2026-05-10")

    def test_rejects_filename_with_path_traversal(self, fake_backups: Path):
        with pytest.raises(ValueError, match="filename"):
            svc.delete_db_dump("daily", "../weekly/podlog-2026-05-10.dump")

    def test_rejects_filename_with_wrong_prefix(self, fake_backups: Path):
        with pytest.raises(ValueError, match="filename"):
            svc.delete_db_dump("daily", "shadow-2026-05-10.dump")

    def test_missing_file_raises_filenotfound(self, fake_backups: Path):
        with pytest.raises(FileNotFoundError):
            svc.delete_db_dump("daily", "podlog-1999-01-01.dump")


class TestDeleteAudioSnapshot:
    def test_deletes_old_snapshot(self, fake_backups: Path):
        svc.delete_audio_snapshot("2026-05-09", today="2026-05-10")
        assert not (fake_backups / "audio" / "2026-05-09").exists()

    def test_rejects_bad_date_shape(self, fake_backups: Path):
        with pytest.raises(ValueError, match="date"):
            svc.delete_audio_snapshot("2026/05/10", today="2026-05-10")

    def test_rejects_path_traversal(self, fake_backups: Path):
        with pytest.raises(ValueError, match="date"):
            svc.delete_audio_snapshot("../db", today="2026-05-10")

    def test_today_without_last_run_is_refused(self, fake_backups: Path):
        # Mid-rsync guard: today's snapshot is unsafe to delete until the
        # backup tick has flushed .last_run.
        with pytest.raises(PermissionError):
            svc.delete_audio_snapshot("2026-05-10", today="2026-05-10")

    def test_today_with_last_run_match_is_allowed(self, fake_backups: Path):
        (fake_backups / ".last_run").write_text("2026-05-10\n")
        svc.delete_audio_snapshot("2026-05-10", today="2026-05-10")
        assert not (fake_backups / "audio" / "2026-05-10").exists()

    def test_missing_dir_raises_filenotfound(self, fake_backups: Path):
        with pytest.raises(FileNotFoundError):
            svc.delete_audio_snapshot("1999-01-01", today="2026-05-10")
