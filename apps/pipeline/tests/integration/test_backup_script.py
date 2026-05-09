"""Integration tests for apps/backup/backup.sh (Issue #682).

Runs the script with stubbed pg_dump / rsync / date so the retention behaviour
is verifiable without a real DB or audio archive.

Each test:
- Builds a temporary BACKUPS_ROOT and AUDIO_SOURCE.
- Drops a fake `pg_dump` (writes a small file at the requested path) and a
  fake `rsync` (creates the target dir) into a temp PATH directory.
- Invokes `run_once` (extracted from `backup.sh` via `bash -c "source ...; run_once"`)
  with a fixed `today` injected by overriding `date` with a small wrapper.
- Inspects the resulting directory tree.
"""
from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
BACKUP_SCRIPT = REPO_ROOT / "apps" / "backup" / "backup.sh"


@pytest.fixture
def script_env(tmp_path: Path):
    """Provision a sandbox: fake bin dir, BACKUPS_ROOT, AUDIO_SOURCE."""
    backups_root = tmp_path / "backups"
    audio_source = tmp_path / "source" / "audio" / "archive"
    fake_bin = tmp_path / "bin"
    backups_root.mkdir()
    audio_source.mkdir(parents=True)
    fake_bin.mkdir()
    # Sample audio file so rsync has something to copy.
    (audio_source / "ep1.wav").write_text("audio")

    # Fake pg_dump: write a small file at the path passed via --file=...
    pg_dump = fake_bin / "pg_dump"
    pg_dump.write_text(
        "#!/bin/bash\n"
        "for arg in \"$@\"; do\n"
        "  case \"$arg\" in --file=*) out=\"${arg#--file=}\"; mkdir -p \"$(dirname \"$out\")\" && echo dump > \"$out\";;\n"
        "  esac\n"
        "done\n"
    )
    pg_dump.chmod(pg_dump.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    # Fake rsync: just mkdir the target. Last positional arg is the destination.
    rsync = fake_bin / "rsync"
    rsync.write_text(
        "#!/bin/bash\n"
        "for last in \"$@\"; do :; done\n"
        "mkdir -p \"$last\"\n"
    )
    rsync.chmod(rsync.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    return {
        "backups_root": backups_root,
        "audio_source": audio_source,
        "fake_bin": fake_bin,
    }


def _run(env_overrides: dict, script_env: dict, today: str = "2026-05-09") -> subprocess.CompletedProcess:
    """Invoke run_once() with the given env. Hijacks `today` by stubbing date in fake_bin."""
    fake_date = script_env["fake_bin"] / "date"
    real_date = subprocess.run(["which", "date"], capture_output=True, text=True).stdout.strip()
    fake_date.write_text(
        "#!/bin/bash\n"
        f"if [[ \"$*\" == \"-u +%Y-%m-%d\" ]]; then echo {today}; exit 0; fi\n"
        f"exec {real_date} \"$@\"\n"
    )
    fake_date.chmod(fake_date.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    env = {
        **os.environ,
        "PATH": f"{script_env['fake_bin']}:{os.environ.get('PATH', '')}",
        "POSTGRES_PASSWORD": "test",
        "POSTGRES_HOST": "db",
        "POSTGRES_USER": "postgres",
        "POSTGRES_DB": "podlog",
        "BACKUP_CHECK_INTERVAL_SECS": "3600",
    }
    env.update(env_overrides)

    # Source the script and call run_once. The script's `mkdir -p`, `: "${VAR:=...}"`
    # and validation all run during sourcing — that's what we want to test.
    env["BACKUPS_ROOT"] = str(script_env["backups_root"])
    env["AUDIO_SOURCE"] = str(script_env["audio_source"])
    cmd = [
        "bash",
        "-c",
        # Source the script — startup validation (exit 1 on bad combos) runs
        # here. If we get past sourcing, invoke run_once for the test scenario.
        f"source {BACKUP_SCRIPT} || exit $?\nrun_once",
    ]
    return subprocess.run(cmd, env=env, capture_output=True, text=True)


def _ls(p: Path) -> list[str]:
    if not p.exists():
        return []
    return sorted(x.name for x in p.iterdir())


class TestRetentionValidation:
    def test_daily_zero_with_weekly_positive_aborts_at_startup(self, script_env):
        """DAILY=0 + WEEKLY>0 is invalid (weekly hardlinks from daily)."""
        result = _run(
            {"BACKUP_RETENTION_DAILY": "0", "BACKUP_RETENTION_WEEKLY": "4", "BACKUP_RETENTION_MONTHLY": "0"},
            script_env,
        )
        assert result.returncode != 0
        assert "FATAL" in result.stderr or "FATAL" in result.stdout

    def test_daily_zero_with_monthly_positive_aborts(self, script_env):
        result = _run(
            {"BACKUP_RETENTION_DAILY": "0", "BACKUP_RETENTION_WEEKLY": "0", "BACKUP_RETENTION_MONTHLY": "12"},
            script_env,
        )
        assert result.returncode != 0


class TestRetentionDisabled:
    def test_all_zero_skips_run(self, script_env):
        """All retention zero → run_once logs 'all retention 0' and writes nothing."""
        _run(
            {"BACKUP_RETENTION_DAILY": "0", "BACKUP_RETENTION_WEEKLY": "0", "BACKUP_RETENTION_MONTHLY": "0"},
            script_env,
        )
        assert _ls(script_env["backups_root"] / "db" / "daily") == []
        assert _ls(script_env["backups_root"] / "db" / "weekly") == []
        assert _ls(script_env["backups_root"] / "db" / "monthly") == []

    def test_weekly_zero_skips_sunday_promotion(self, script_env):
        """Sunday run with WEEKLY=0 → daily file written, weekly stays empty."""
        # 2026-05-10 is a Sunday.
        _run(
            {"BACKUP_RETENTION_DAILY": "7", "BACKUP_RETENTION_WEEKLY": "0", "BACKUP_RETENTION_MONTHLY": "12"},
            script_env,
            today="2026-05-10",
        )
        daily = _ls(script_env["backups_root"] / "db" / "daily")
        weekly = _ls(script_env["backups_root"] / "db" / "weekly")
        assert daily == ["podlog-2026-05-10.dump"]
        assert weekly == []

    def test_monthly_zero_skips_first_of_month_promotion(self, script_env):
        """1st-of-month run with MONTHLY=0 → daily file written, monthly stays empty."""
        _run(
            {"BACKUP_RETENTION_DAILY": "7", "BACKUP_RETENTION_WEEKLY": "4", "BACKUP_RETENTION_MONTHLY": "0"},
            script_env,
            today="2026-06-01",
        )
        daily = _ls(script_env["backups_root"] / "db" / "daily")
        monthly = _ls(script_env["backups_root"] / "db" / "monthly")
        assert daily == ["podlog-2026-06-01.dump"]
        assert monthly == []


class TestRetentionRollingOne:
    def test_daily_one_keeps_only_latest_after_two_runs(self, script_env, tmp_path):
        """DAILY=1 → after two runs on different dates, only the latest file remains."""
        # First run on day 1
        _run(
            {"BACKUP_RETENTION_DAILY": "1", "BACKUP_RETENTION_WEEKLY": "0", "BACKUP_RETENTION_MONTHLY": "0"},
            script_env,
            today="2026-05-08",
        )
        # Clear last_run so the second invocation actually executes for a new date
        last_run = script_env["backups_root"] / ".last_run"
        if last_run.exists():
            last_run.unlink()
        _run(
            {"BACKUP_RETENTION_DAILY": "1", "BACKUP_RETENTION_WEEKLY": "0", "BACKUP_RETENTION_MONTHLY": "0"},
            script_env,
            today="2026-05-09",
        )
        daily = _ls(script_env["backups_root"] / "db" / "daily")
        assert daily == ["podlog-2026-05-09.dump"], daily
