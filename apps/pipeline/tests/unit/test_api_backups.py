"""Unit tests for the /api/backups endpoint (#646)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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


def test_reports_retention_zero_as_disabled(tmp_path: Path) -> None:
    (tmp_path / "db" / "daily").mkdir(parents=True)
    with (
        patch("app.api.backups._BACKUPS_ROOT", tmp_path),
        patch("app.api.backups.settings") as mock_settings,
    ):
        mock_settings.backup_retention_daily = 0
        mock_settings.backup_retention_weekly = 0
        mock_settings.backup_retention_monthly = 0
        resp = client.get("/api/backups")

    assert resp.status_code == 200
    assert resp.json()["enabled"] is False
