"""Unit tests for the /api/backups endpoint (#646)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import get_db
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _stub_backup_retention():
    """Issue #683: /api/backups now resolves retention via the DB. Unit tests
    don't have a real DB, so stub the lookup to return env defaults and
    override get_db so FastAPI doesn't try to open a connection.
    """
    def _fake_get_db():
        yield None

    app.dependency_overrides[get_db] = _fake_get_db
    with patch(
        "app.api.backups.get_backup_retention",
        return_value={
            "daily": int(settings.backup_retention_daily),
            "weekly": int(settings.backup_retention_weekly),
            "monthly": int(settings.backup_retention_monthly),
        },
    ):
        yield
    app.dependency_overrides.pop(get_db, None)


def _make_backups_tree(root: Path) -> None:
    (root / "db" / "daily").mkdir(parents=True)
    (root / "db" / "weekly").mkdir(parents=True)
    (root / "db" / "monthly").mkdir(parents=True)
    (root / "audio" / "2026-05-02").mkdir(parents=True)
    (root / "audio" / "2026-05-03").mkdir(parents=True)

    (root / "db" / "daily" / "podlog-2026-05-03.dump").write_bytes(b"x" * 1024)
    (root / "db" / "daily" / "podlog-2026-05-02.dump").write_bytes(b"y" * 2048)
    (root / "db" / "weekly" / "podlog-2026-04-26.dump").write_bytes(b"z" * 4096)
    (root / "db" / "monthly" / "podlog-2026-05-01.dump").write_bytes(b"m" * 8192)

    (root / "audio" / "2026-05-03" / "ep-001.opus").write_bytes(b"a" * 4096)
    (root / "audio" / "2026-05-02" / "ep-001.opus").write_bytes(b"a" * 4096)
    (root / "audio" / "2026-05-02" / "ep-002.opus").write_bytes(b"b" * 2048)

    # Last-run flag dropped by backup.sh.
    (root / ".last_run").write_text("2026-05-03\n")


def test_lists_backups_grouped_by_tier(tmp_path: Path) -> None:
    _make_backups_tree(tmp_path)

    with patch("app.api.backups._BACKUPS_ROOT", tmp_path):
        resp = client.get("/api/backups")

    assert resp.status_code == 200
    body = resp.json()

    assert body["enabled"] is True
    assert body["mounted"] is True
    assert body["last_run"] == "2026-05-03"

    # Daily — newest first.
    daily = body["db"]["daily"]
    assert [d["date"] for d in daily] == ["2026-05-03", "2026-05-02"]
    assert daily[0]["size_bytes"] == 1024

    assert [d["date"] for d in body["db"]["weekly"]] == ["2026-04-26"]
    assert [d["date"] for d in body["db"]["monthly"]] == ["2026-05-01"]

    # Audio — newest first; sizes are tree totals.
    audio = body["audio"]
    assert [s["date"] for s in audio] == ["2026-05-03", "2026-05-02"]
    assert audio[0]["size_bytes"] == 4096
    assert audio[1]["size_bytes"] == 4096 + 2048


def test_returns_empty_lists_when_backups_dir_missing(tmp_path: Path) -> None:
    # Point at a non-existent path.
    missing = tmp_path / "does-not-exist"
    with patch("app.api.backups._BACKUPS_ROOT", missing):
        resp = client.get("/api/backups")

    assert resp.status_code == 200
    body = resp.json()
    assert body["mounted"] is False
    assert body["db"] == {"daily": [], "weekly": [], "monthly": []}
    assert body["audio"] == []
    assert body["last_run"] is None


def test_ignores_non_dump_files_and_unparseable_dirs(tmp_path: Path) -> None:
    (tmp_path / "db" / "daily").mkdir(parents=True)
    (tmp_path / "audio").mkdir()

    # Junk in the tier dir.
    (tmp_path / "db" / "daily" / "podlog-2026-05-03.dump").write_bytes(b"x")
    (tmp_path / "db" / "daily" / "README.md").write_text("not a dump")
    (tmp_path / "db" / "daily" / "podlog-bogus.dump").write_text("bad date")

    # Junk in audio dir.
    (tmp_path / "audio" / "2026-05-03").mkdir()
    (tmp_path / "audio" / "scratch").mkdir()
    (tmp_path / "audio" / "metadata.json").write_text("{}")

    with patch("app.api.backups._BACKUPS_ROOT", tmp_path):
        resp = client.get("/api/backups")

    body = resp.json()
    assert [d["filename"] for d in body["db"]["daily"]] == ["podlog-2026-05-03.dump"]
    assert [s["date"] for s in body["audio"]] == ["2026-05-03"]


def test_skips_symlinked_dump_file_and_audio_dir(tmp_path: Path) -> None:
    # Set up a real backup tree alongside an "outside" target the symlinks
    # will point to. The endpoint must skip the symlinks so it can't be
    # tricked into reporting sizes for files outside the mount.
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.dump").write_bytes(b"S" * 9999)
    (outside / "secret-audio").mkdir()
    (outside / "secret-audio" / "leak.opus").write_bytes(b"L" * 7777)

    backups = tmp_path / "backups"
    (backups / "db" / "daily").mkdir(parents=True)
    (backups / "audio").mkdir()

    # Real, allowed dump.
    (backups / "db" / "daily" / "podlog-2026-05-03.dump").write_bytes(b"x" * 100)

    # Planted symlinks pretending to be backups.
    (backups / "db" / "daily" / "podlog-1999-01-01.dump").symlink_to(
        outside / "secret.dump"
    )
    (backups / "audio" / "1999-01-01").symlink_to(outside / "secret-audio")

    with patch("app.api.backups._BACKUPS_ROOT", backups):
        resp = client.get("/api/backups")

    body = resp.json()
    daily_dates = [d["date"] for d in body["db"]["daily"]]
    assert "1999-01-01" not in daily_dates
    assert daily_dates == ["2026-05-03"]
    audio_dates = [s["date"] for s in body["audio"]]
    assert "1999-01-01" not in audio_dates


def test_last_run_with_invalid_utf8_falls_back_to_none(tmp_path: Path) -> None:
    (tmp_path / "db" / "daily").mkdir(parents=True)
    (tmp_path / ".last_run").write_bytes(b"\xff\xfe\x00bad")

    with patch("app.api.backups._BACKUPS_ROOT", tmp_path):
        resp = client.get("/api/backups")

    assert resp.status_code == 200
    assert resp.json()["last_run"] is None


def test_reports_retention_zero_as_disabled(tmp_path: Path) -> None:
    (tmp_path / "db" / "daily").mkdir(parents=True)
    with (
        patch("app.api.backups._BACKUPS_ROOT", tmp_path),
        patch(
            "app.api.backups.get_backup_retention",
            return_value={"daily": 0, "weekly": 0, "monthly": 0},
        ),
    ):
        resp = client.get("/api/backups")

    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


# ---------------------------------------------------------------------------
# DELETE endpoints (#687)


class TestDeleteDbBackup:
    def test_success_returns_200(self) -> None:
        with patch("app.api.backups.delete_db_dump") as mock:
            resp = client.delete("/api/backups/db/daily/podlog-2026-05-10.dump")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True}
        mock.assert_called_once_with("daily", "podlog-2026-05-10.dump")

    def test_validation_error_returns_400(self) -> None:
        with patch(
            "app.api.backups.delete_db_dump",
            side_effect=ValueError("bad tier"),
        ):
            resp = client.delete("/api/backups/db/hourly/podlog-2026-05-10.dump")
        assert resp.status_code == 400
        assert "bad tier" in resp.json()["detail"]

    def test_missing_file_returns_404(self) -> None:
        with patch(
            "app.api.backups.delete_db_dump",
            side_effect=FileNotFoundError("nope"),
        ):
            resp = client.delete("/api/backups/db/daily/podlog-1999-01-01.dump")
        assert resp.status_code == 404


class TestDeleteAudioBackup:
    def test_success_returns_200(self) -> None:
        with patch("app.api.backups.delete_audio_snapshot") as mock:
            resp = client.delete("/api/backups/audio/2026-05-09")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True}
        # First positional arg is the date; the `today` kwarg is set to
        # today's UTC date by the route — assert only the shape we control.
        args, kwargs = mock.call_args
        assert args == ("2026-05-09",)
        assert "today" in kwargs

    def test_validation_error_returns_400(self) -> None:
        with patch(
            "app.api.backups.delete_audio_snapshot",
            side_effect=ValueError("bad date"),
        ):
            resp = client.delete("/api/backups/audio/2026-05")
        assert resp.status_code == 400

    def test_missing_dir_returns_404(self) -> None:
        with patch(
            "app.api.backups.delete_audio_snapshot",
            side_effect=FileNotFoundError("missing"),
        ):
            resp = client.delete("/api/backups/audio/1999-01-01")
        assert resp.status_code == 404

    def test_mid_rsync_returns_409(self) -> None:
        """Today's snapshot before today's tick has finished — retry later."""
        with patch(
            "app.api.backups.delete_audio_snapshot",
            side_effect=PermissionError("mid-rsync"),
        ):
            resp = client.delete("/api/backups/audio/2026-05-10")
        assert resp.status_code == 409
