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

# When all retention values are 0 the user has effectively opted out.
RETENTION_TOTAL=$((BACKUP_RETENTION_DAILY + BACKUP_RETENTION_WEEKLY + BACKUP_RETENTION_MONTHLY))

BACKUPS_ROOT="/backups"
DB_DAILY="$BACKUPS_ROOT/db/daily"
DB_WEEKLY="$BACKUPS_ROOT/db/weekly"
DB_MONTHLY="$BACKUPS_ROOT/db/monthly"
AUDIO_ROOT="$BACKUPS_ROOT/audio"
AUDIO_SOURCE="/source/audio/archive"
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

  # Promote to weekly on Sundays (cron-style: %u = 7).
  if [ "$(date -d "$date_str" +%u)" = "7" ]; then
    cp -al "$target" "$DB_WEEKLY/podlog-$date_str.dump" 2>/dev/null \
      || cp "$target" "$DB_WEEKLY/podlog-$date_str.dump"
    log "db weekly link → $DB_WEEKLY/podlog-$date_str.dump"
  fi

  # Promote to monthly on the 1st.
  if [ "$(date -d "$date_str" +%d)" = "01" ]; then
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

  # Pick the most recent existing snapshot to hardlink unchanged files
  # against. ISO dates sort lexically.
  local previous
  previous=$(find "$AUDIO_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' \
    | sort | tail -n 1)

  log "audio snapshot → $target (link-dest: ${previous:-none})"

  local link_dest_arg=""
  if [ -n "$previous" ] && [ "$previous" != "$target" ]; then
    link_dest_arg="--link-dest=$previous"
  fi

  rsync -a --delete $link_dest_arg "$AUDIO_SOURCE/" "$target.partial/"
  mv "$target.partial" "$target"
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

main "$@"
