"""Runtime backup-retention settings (#683).

Companion to env-var defaults set by `BACKUP_RETENTION_{DAILY,WEEKLY,MONTHLY}`.
A row in `system_state` (key=`backup_retention`, value=JSON blob) holds any
runtime override the user saved in Settings → Backups. `backup.sh` reads the
same row at the start of every tick to honor the change without restart.

Validation mirrors the script-level rule from #682: `daily=0` with `weekly>0`
or `monthly>0` is rejected because weekly/monthly hardlink from the daily
file. The script applies the same check defensively.
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState


SETTINGS_KEY = "backup_retention"


def _env_defaults() -> dict[str, int]:
    return {
        "daily": int(settings.backup_retention_daily),
        "weekly": int(settings.backup_retention_weekly),
        "monthly": int(settings.backup_retention_monthly),
    }


def get_backup_retention(db: Session) -> dict[str, int]:
    """Return effective retention values: DB override if present, else env defaults."""
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    if row is None:
        return _env_defaults()
    try:
        stored = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return _env_defaults()
    out = _env_defaults()
    for key in ("daily", "weekly", "monthly"):
        if isinstance(stored.get(key), int) and stored[key] >= 0:
            out[key] = stored[key]
    return out


def _validate(values: dict[str, int]) -> None:
    for key in ("daily", "weekly", "monthly"):
        v = values.get(key)
        if not isinstance(v, int) or v < 0:
            raise ValueError(f"{key} must be a non-negative integer, got {v!r}")
    if values["daily"] == 0 and (values["weekly"] > 0 or values["monthly"] > 0):
        raise ValueError(
            "daily=0 requires weekly=0 and monthly=0 — weekly and monthly hardlink "
            "from the daily file"
        )


def save_backup_retention(db: Session, payload: dict) -> dict[str, int]:
    """Validate + persist a retention override. Returns the effective values."""
    values = {
        "daily": int(payload.get("daily", _env_defaults()["daily"])),
        "weekly": int(payload.get("weekly", _env_defaults()["weekly"])),
        "monthly": int(payload.get("monthly", _env_defaults()["monthly"])),
    }
    _validate(values)

    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    blob = json.dumps(values)
    if row is None:
        db.add(SystemState(key=SETTINGS_KEY, value=blob))
    else:
        row.value = blob
    db.commit()
    return values
