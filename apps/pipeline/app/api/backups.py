"""
Backup-listing endpoint (#646).

Reads /backups (mounted ro from the host's ./backups/ via docker-compose)
and returns the available DB dumps and audio snapshots, grouped by tier.
The Settings page in the web app uses this to show what's currently
recoverable.

The `backup` service writes:
  /backups/db/daily/podlog-YYYY-MM-DD.dump
  /backups/db/weekly/podlog-YYYY-MM-DD.dump
  /backups/db/monthly/podlog-YYYY-MM-DD.dump
  /backups/audio/YYYY-MM-DD/

This endpoint never touches the files; it only stats them.
"""
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

_BACKUPS_ROOT = Path("/backups")
_DUMP_RE = re.compile(r"^podlog-(\d{4}-\d{2}-\d{2})\.dump$")
_DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _list_db_tier(dirname: str) -> list[dict]:
    """Return [{date, filename, size_bytes}] for every dump in one tier dir."""
    tier_dir = _BACKUPS_ROOT / "db" / dirname
    if not tier_dir.is_dir():
        return []
    out: list[dict] = []
    for entry in tier_dir.iterdir():
        # Skip symlinks defensively — backup.sh never creates them, so
        # any link inside /backups was planted out-of-band and would
        # let stat() report sizes of files outside the mount.
        if entry.is_symlink() or not entry.is_file():
            continue
        m = _DUMP_RE.match(entry.name)
        if not m:
            continue
        try:
            size = entry.stat().st_size
        except OSError:
            continue
        out.append({"date": m.group(1), "filename": entry.name, "size_bytes": size})
    # Newest first — ISO dates sort lexically.
    out.sort(key=lambda r: r["date"], reverse=True)
    return out


def _audio_dir_size(path: Path) -> int:
    """Sum file sizes under an audio snapshot dir.

    rsync --link-dest hardlinks unchanged files across snapshots, so the
    apparent du-size per snapshot overcounts shared inodes. We accept
    that for the Settings display — users want a "how big is this" hint,
    not exact disk usage. Walking the tree once per snapshot is cheap
    relative to the page render.
    """
    # `os.walk(top, followlinks=False)` only refuses to descend into
    # symlinks discovered during the walk; it still traverses `top`
    # itself. Refuse a symlinked starting point so a planted symlink
    # in /backups/audio/<date> can't redirect the walk outside the mount.
    if path.is_symlink():
        return 0
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for f in files:
            p = Path(root) / f
            try:
                total += p.lstat().st_size
            except OSError:
                continue
    return total


def _list_audio_snapshots() -> list[dict]:
    audio_dir = _BACKUPS_ROOT / "audio"
    if not audio_dir.is_dir():
        return []
    out: list[dict] = []
    for entry in audio_dir.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            continue
        if not _DATE_DIR_RE.match(entry.name):
            continue
        out.append({"date": entry.name, "size_bytes": _audio_dir_size(entry)})
    out.sort(key=lambda r: r["date"], reverse=True)
    return out


def _read_last_run() -> str | None:
    p = _BACKUPS_ROOT / ".last_run"
    if not p.is_file():
        return None
    try:
        return p.read_text(encoding="utf-8").strip() or None
    except (OSError, ValueError):
        # ValueError covers UnicodeDecodeError if .last_run somehow holds
        # non-UTF-8 bytes. backup.sh writes a clean ISO date so this is
        # belt-and-braces — but a 500 here would break the whole tab.
        return None


@router.get("/backups")
def get_backups() -> dict:
    """List available backups grouped by tier.

    Returns retention config alongside the inventory so the Settings UI
    can show "X of N kept" without having to read env vars itself.
    """
    daily = _list_db_tier("daily")
    weekly = _list_db_tier("weekly")
    monthly = _list_db_tier("monthly")
    audio = _list_audio_snapshots()
    enabled = (
        settings.backup_retention_daily
        + settings.backup_retention_weekly
        + settings.backup_retention_monthly
    ) > 0
    return {
        "enabled": enabled,
        "mounted": _BACKUPS_ROOT.is_dir(),
        "retention": {
            "daily": settings.backup_retention_daily,
            "weekly": settings.backup_retention_weekly,
            "monthly": settings.backup_retention_monthly,
        },
        "last_run": _read_last_run(),
        "db": {"daily": daily, "weekly": weekly, "monthly": monthly},
        "audio": audio,
    }
