#!/bin/bash
# Restore the Podlog DB from a dated dump (#630).
#
# Usage (inside container — invoke via the Make target):
#   restore-db.sh <YYYY-MM-DD>
#
# This is destructive: drops + recreates the `podlog` database.

set -euo pipefail

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=podlog}"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <YYYY-MM-DD>" >&2
  exit 1
fi
DATE="$1"

# Find the dump in any of the retention buckets (newest first).
DUMP=""
for dir in /backups/db/daily /backups/db/weekly /backups/db/monthly; do
  candidate="$dir/podlog-$DATE.dump"
  if [ -f "$candidate" ]; then
    DUMP="$candidate"
    break
  fi
done

if [ -z "$DUMP" ]; then
  echo "No dump found for $DATE in /backups/db/{daily,weekly,monthly}" >&2
  echo "Available daily dumps:" >&2
  find /backups/db/daily -mindepth 1 -maxdepth 1 -name 'podlog-*.dump' \
    -printf '  %f\n' 2>/dev/null | sort | tail -n 20 >&2
  exit 1
fi

echo "Restoring DB from $DUMP" >&2
echo "This will DROP and recreate the '$POSTGRES_DB' database." >&2

# Drop + recreate via the postgres maintenance database. pg_restore --clean
# alone leaves objects partially dropped if the dump is custom-format and
# was taken from a different schema state, so we hard-reset the DB first.
export PGPASSWORD="$POSTGRES_PASSWORD"

psql --host="$POSTGRES_HOST" --username="$POSTGRES_USER" --dbname=postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  >/dev/null

psql --host="$POSTGRES_HOST" --username="$POSTGRES_USER" --dbname=postgres -c \
  "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" >/dev/null

psql --host="$POSTGRES_HOST" --username="$POSTGRES_USER" --dbname=postgres -c \
  "CREATE DATABASE \"$POSTGRES_DB\";" >/dev/null

pg_restore \
  --host="$POSTGRES_HOST" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-owner \
  --no-acl \
  "$DUMP"

echo "Restore complete. Restart the pipeline + worker to pick up the new state:" >&2
echo "  docker compose restart pipeline worker" >&2
