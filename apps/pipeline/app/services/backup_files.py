"""Safe file deletion helpers for the Backups tab (#687).

The pipeline container mounts /backups read-write so it can satisfy the
DELETE endpoints. This module is the *only* place that writes under
/backups; everything else just reads.

Validation philosophy: refuse anything that doesn't match the exact
filename / tier / date shape produced by ``apps/backup/backup.sh``. After
constructing the candidate path, also resolve it and assert the resolved
path stays inside the allowed root — defence-in-depth against any clever
input that survives the regex check.

Errors raised here:

- ``ValueError``  → bad shape (tier, filename, date). Maps to HTTP 400.
- ``FileNotFoundError`` → nothing to delete at that path. HTTP 404.
- ``PermissionError`` → today's audio snapshot before today's backup
  tick has finished (possibly mid-rsync). HTTP 409.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

_BACKUPS_ROOT = Path("/backups")
_DB_ROOT = _BACKUPS_ROOT / "db"
_AUDIO_ROOT = _BACKUPS_ROOT / "audio"
_LAST_RUN_FILE = _BACKUPS_ROOT / ".last_run"

_VALID_TIERS = frozenset({"daily", "weekly", "monthly"})
_DUMP_FILENAME_RE = re.compile(r"^podlog-\d{4}-\d{2}-\d{2}\.dump$")
_DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _safe_resolve(candidate: Path, allowed_root: Path) -> Path:
    """Resolve ``candidate`` and assert it sits under ``allowed_root``.

    Catches symlink shenanigans and any leftover ``..`` segments that
    survived the upstream regex (shouldn't happen, but ``unlink``/``rmtree``
    are destructive so we double-check).
    """
    resolved = candidate.resolve()
    root_resolved = allowed_root.resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(
            f"resolved path {resolved} escapes allowed root {root_resolved}"
        ) from exc
    return resolved


def delete_db_dump(tier: str, filename: str) -> None:
    """Delete one DB dump from a tier directory.

    Hardlinks across tiers (weekly/monthly point at the daily inode) keep
    the data alive on disk if other tiers still reference it — that's a
    feature, not a bug. ``unlink`` removes only the directory entry.
    """
    if tier not in _VALID_TIERS:
        raise ValueError(f"tier must be one of {sorted(_VALID_TIERS)}, got {tier!r}")
    if not _DUMP_FILENAME_RE.match(filename):
        raise ValueError(
            f"filename must match podlog-YYYY-MM-DD.dump, got {filename!r}"
        )

    candidate = _DB_ROOT / tier / filename
    target = _safe_resolve(candidate, _DB_ROOT / tier)
    if not target.is_file():
        raise FileNotFoundError(f"{candidate} does not exist")
    target.unlink()


def _read_last_run() -> str | None:
    if not _LAST_RUN_FILE.is_file():
        return None
    try:
        return _LAST_RUN_FILE.read_text(encoding="utf-8").strip() or None
    except (OSError, ValueError):
        return None


def delete_audio_snapshot(date: str, today: str | None) -> None:
    """Delete one audio snapshot directory.

    Today's snapshot may still be in the middle of rsync (the snapshot dir
    exists but ``.last_run`` hasn't been updated yet). Refuse the delete in
    that window — the user can retry once the tick completes (within an
    hour by default).
    """
    if not _DATE_DIR_RE.match(date):
        raise ValueError(f"date must be YYYY-MM-DD, got {date!r}")

    if today is not None and date == today:
        last_run = _read_last_run()
        if last_run != today:
            raise PermissionError(
                f"today's audio snapshot ({date}) may be mid-rsync — wait for "
                "the current backup tick to finish, then retry"
            )

    candidate = _AUDIO_ROOT / date
    target = _safe_resolve(candidate, _AUDIO_ROOT)
    if not target.is_dir():
        raise FileNotFoundError(f"{candidate} does not exist")
    shutil.rmtree(target)
