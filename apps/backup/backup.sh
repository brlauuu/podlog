#!/bin/bash
# Daily backup runner for the Podlog `backup` service (#630).
#
# Loops forever, waking hourly. Each tick checks whether a new daily
# backup is due (date in /backups/.last_run vs today). When due, dumps
# the DB and rsync-snapshots the audio archive, then prunes by
# retention.
#
# Idempotent across restarts: the last-run flag prevents same-day
# duplicate runs even if the container is bounced.

set -euo pipefail

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=podlog}"
: "${BACKUP_RETENTION_DAILY:=7}"
: "${BACKUP_RETENTION_WEEKLY:=4}"
: "${BACKUP_RETENTION_MONTHLY:=12}"
: "${BACKUP_CHECK_INTERVAL_SECS:=3600}"

# Retention values support (#682):
#   0 — disable that tier (no file written, no promotion, pruning wipes any leftovers)
#   1 — keep only the latest backup in that tier (rolling overwrite)
#   N — keep up to N most recent
#
# Daily is the source the weekly/monthly tiers hardlink from. Refusing
# DAILY=0 with WEEKLY>0 or MONTHLY>0 keeps the model simple — a separate
# follow-up (#683) will introduce decoupled tiers via runtime UI.
if [ "$BACKUP_RETENTION_DAILY" -eq 0 ] \
  && { [ "$BACKUP_RETENTION_WEEKLY" -gt 0 ] || [ "$BACKUP_RETENTION_MONTHLY" -gt 0 ]; }; then
  printf '%s | %s\n' "$(date -Iseconds)" \
    "FATAL: BACKUP_RETENTION_DAILY=0 requires WEEKLY=0 and MONTHLY=0 (weekly/monthly hardlink from daily)" >&2
  exit 1
fi

# When all retention values are 0 the user has effectively opted out.
RETENTION_TOTAL=$((BACKUP_RETENTION_DAILY + BACKUP_RETENTION_WEEKLY + BACKUP_RETENTION_MONTHLY))

# Path defaults match the production volume mounts in docker-compose.yml.
# Overridable via env so tests can sandbox without touching the real paths.
: "${BACKUPS_ROOT:=/backups}"
: "${AUDIO_SOURCE:=/source/audio/archive}"
DB_DAILY="$BACKUPS_ROOT/db/daily"
DB_WEEKLY="$BACKUPS_ROOT/db/weekly"
DB_MONTHLY="$BACKUPS_ROOT/db/monthly"
AUDIO_ROOT="$BACKUPS_ROOT/audio"
LAST_RUN_FILE="$BACKUPS_ROOT/.last_run"

mkdir -p "$DB_DAILY" "$DB_WEEKLY" "$DB_MONTHLY" "$AUDIO_ROOT"

log() {
  printf '%s | %s\n' "$(date -Iseconds)" "$*" >&2
}

dump_db() {
  local date_str="$1"
  local target="$DB_DAILY/podlog-$date_str.dump"
  log "db dump → $target"

  # Custom format: compressed, supports `pg_restore` partial restores.
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --format=custom \
    --host="$POSTGRES_HOST" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --file="$target.partial"
  mv "$target.partial" "$target"

  # Promote to weekly on Sundays (cron-style: %u = 7), unless that tier
  # is disabled (#682).
  if [ "$BACKUP_RETENTION_WEEKLY" -gt 0 ] && [ "$(date -d "$date_str" +%u)" = "7" ]; then
    # rm first so a same-day re-run keeps the hardlink rather than falling
    # through to the non-link cp on EEXIST.
    rm -f "$DB_WEEKLY/podlog-$date_str.dump"
    cp -al "$target" "$DB_WEEKLY/podlog-$date_str.dump" 2>/dev/null \
      || cp "$target" "$DB_WEEKLY/podlog-$date_str.dump"
    log "db weekly link → $DB_WEEKLY/podlog-$date_str.dump"
  fi

  # Promote to monthly on the 1st, unless that tier is disabled (#682).
  if [ "$BACKUP_RETENTION_MONTHLY" -gt 0 ] && [ "$(date -d "$date_str" +%d)" = "01" ]; then
    rm -f "$DB_MONTHLY/podlog-$date_str.dump"
    cp -al "$target" "$DB_MONTHLY/podlog-$date_str.dump" 2>/dev/null \
      || cp "$target" "$DB_MONTHLY/podlog-$date_str.dump"
    log "db monthly link → $DB_MONTHLY/podlog-$date_str.dump"
  fi
}

snapshot_audio() {
  local date_str="$1"
  local target="$AUDIO_ROOT/$date_str"

  if [ ! -d "$AUDIO_SOURCE" ]; then
    log "audio source missing ($AUDIO_SOURCE) — skipping audio snapshot"
    return 0
  fi

  # Pick the most recent existing snapshot — excluding today's target —
  # to hardlink unchanged files against. ISO dates sort lexically. The
  # `! -path` filter avoids picking ourselves on a same-day retry, which
  # would either no-op the link-dest or pin to stale state.
  local previous
  previous=$(find "$AUDIO_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' \
    ! -path "$target" \
    | sort | tail -n 1)

  log "audio snapshot → $target (link-dest: ${previous:-none})"

  local link_dest_arg=""
  if [ -n "$previous" ]; then
    link_dest_arg="--link-dest=$previous"
  fi

  # rsync directly into the target — no partial-dir dance. `mv` of a
  # directory over an existing directory NESTS rather than replaces, so
  # the partial-pattern that works for files (DB dumps) breaks for dirs.
  # Idempotency guarantees: if the run crashes mid-rsync, the next run
  # rsyncs into the same target with --delete, which reconciles to
  # source state. The trade-off is that an ongoing rsync leaves the
  # snapshot in an inconsistent state visible to readers — acceptable
  # for a daily backup; restore from yesterday's snapshot if today's
  # is mid-update.
  rsync -a --delete $link_dest_arg "$AUDIO_SOURCE/" "$target/"
}

# Prune a directory of dump files (oldest first) keeping only N most
# recent. Files are named podlog-YYYY-MM-DD.dump so lexical sort is
# chronological.
prune_db_dir() {
  local dir="$1"
  local keep="$2"
  if [ "$keep" -le 0 ]; then
    log "retention 0 for $dir — wiping"
    find "$dir" -mindepth 1 -maxdepth 1 -name '*.dump' -delete
    return 0
  fi
  local files
  files=$(find "$dir" -mindepth 1 -maxdepth 1 -name '*.dump' | sort)
  local count
  count=$(echo "$files" | grep -c . || true)
  local drop=$((count - keep))
  if [ "$drop" -le 0 ]; then return 0; fi
  echo "$files" | head -n "$drop" | while read -r f; do
    [ -n "$f" ] && rm -f "$f" && log "pruned $f"
  done
}

# Audio retention: keep dates that exist as DB dumps (any of
# daily/weekly/monthly). This keeps the audio + DB co-located by date.
prune_audio() {
  local kept_dates
  kept_dates=$(
    {
      find "$DB_DAILY" "$DB_WEEKLY" "$DB_MONTHLY" -mindepth 1 -maxdepth 1 \
        -name 'podlog-*.dump' -printf '%f\n' 2>/dev/null \
        | sed -e 's/^podlog-//' -e 's/\.dump$//'
    } | sort -u
  )
  find "$AUDIO_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' \
    -printf '%f\n' \
    | while read -r snap; do
      if ! echo "$kept_dates" | grep -qx "$snap"; then
        rm -rf "${AUDIO_ROOT:?}/$snap" && log "pruned audio/$snap"
      fi
    done
}

run_once() {
  if [ "$RETENTION_TOTAL" -eq 0 ]; then
    log "all retention values are 0 — backups disabled, skipping"
    return 0
  fi

  local today
  today=$(date -u +%Y-%m-%d)
  local last=""
  [ -f "$LAST_RUN_FILE" ] && last=$(cat "$LAST_RUN_FILE")

  if [ "$last" = "$today" ]; then
    return 0  # already ran today
  fi

  log "running daily backup for $today (last run: ${last:-never})"

  if dump_db "$today" && snapshot_audio "$today"; then
    prune_db_dir "$DB_DAILY"   "$BACKUP_RETENTION_DAILY"
    prune_db_dir "$DB_WEEKLY"  "$BACKUP_RETENTION_WEEKLY"
    prune_db_dir "$DB_MONTHLY" "$BACKUP_RETENTION_MONTHLY"
    prune_audio
    echo "$today" > "$LAST_RUN_FILE"
    log "backup complete"
  else
    log "backup FAILED (will retry next tick)"
    return 1
  fi
}

main() {
  log "podlog backup service starting"
  log "retention: daily=$BACKUP_RETENTION_DAILY weekly=$BACKUP_RETENTION_WEEKLY monthly=$BACKUP_RETENTION_MONTHLY"
  log "check interval: ${BACKUP_CHECK_INTERVAL_SECS}s"

  while true; do
    run_once || log "tick failed, continuing"
    sleep "$BACKUP_CHECK_INTERVAL_SECS"
  done
}

# Run main only when invoked directly. Allows tests to source this file
# and call individual functions (run_once, dump_db, prune_db_dir).
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
