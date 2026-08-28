#!/usr/bin/env bash
#
# Update a running Podlog install (#937, phase 3).
#
#   make update                 follow PODLOG_CHANNEL from .env (default stable)
#   make update VERSION=1.0.0   pin an exact version -- also the downgrade path
#
# The order below is the point of the script. Anyone can run `git pull &&
# docker compose up -d`; what that misses is that the worker may be halfway
# through transcribing an episode, that a migration runs on pipeline start
# with no dump taken first, and that a failure leaves you with no stated way
# back. Each step here exists because skipping it loses something.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

CHANNEL_DEFAULT=stable
PIN="${VERSION:-}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
say "Checking the working copy"

if [ -n "$(git status --porcelain)" ]; then
  fail "the working copy has uncommitted changes."
  echo "  Updating moves HEAD, which would either fail or bury your edits."
  echo "  Commit or stash them first:  git stash"
  exit 1
fi
echo "clean"

CHANNEL="$CHANNEL_DEFAULT"
if [ -f .env ]; then
  FROM_ENV=$(grep -E '^\s*PODLOG_CHANNEL=' .env | tail -1 | cut -d= -f2- | tr -d ' "' || true)
  [ -n "${FROM_ENV:-}" ] && CHANNEL="$FROM_ENV"
fi

if [ -n "$PIN" ]; then
  echo "target: pinned version $PIN"
elif [ "$CHANNEL" = "edge" ]; then
  echo "target: edge (current main)"
elif [ "$CHANNEL" = "stable" ]; then
  echo "target: stable (newest release tag)"
else
  fail "PODLOG_CHANNEL is '$CHANNEL'; expected 'stable' or 'edge'."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Drain
# ---------------------------------------------------------------------------
# CLAUDE.md's "worker is non-interruptible" rule, enforced instead of written
# down. concurrency=1 and a transcription can run for minutes; restarting
# mid-job loses the work and the episode comes back as SYSTEM_ERROR via the
# zombie sweep.
say "Draining the queue"
BUSY=$(docker compose exec -T db psql -U postgres podlog -tAc \
  "SELECT count(*) FROM job_queue WHERE status IN ('pending','running');" 2>/dev/null | tr -d ' ')

if [ -z "${BUSY:-}" ]; then
  fail "could not reach the database to check the queue."
  echo "  Is the stack running? Start it with 'make up', or stop everything"
  echo "  first if you are updating a stopped install."
  exit 1
fi

if [ "$BUSY" != "0" ]; then
  echo "$BUSY job(s) pending or running."
  echo "Stopping the worker gracefully (up to 60s for the current job)..."
  docker compose stop -t 60 worker
  STILL=$(docker compose exec -T db psql -U postgres podlog -tAc \
    "SELECT count(*) FROM job_queue WHERE status = 'running';" 2>/dev/null | tr -d ' ')
  if [ "${STILL:-0}" != "0" ]; then
    fail "a job is still marked running after the grace period."
    echo "  It will be picked up again after the update, but if it was mid-"
    echo "  transcription that work is lost. Re-run when the queue is idle,"
    echo "  or accept it and re-run this command."
    exit 1
  fi
  echo "worker stopped, nothing running"
else
  echo "queue idle"
fi

# ---------------------------------------------------------------------------
# 2. Back up
# ---------------------------------------------------------------------------
# Not "the nightly backup will do". A migration that goes wrong against a
# day-old dump costs a day of transcription, which on this hardware is hours
# of CPU you cannot get back.
say "Taking a database backup"
# Ask the container for the date, do not compute it here. backup.sh names the
# dump from `date -u`, while this script runs in the host's timezone, so for
# everyone east of UTC every `make update` run between local midnight and UTC
# midnight waited for a file that could never appear.
TODAY=$(docker compose exec -T backup date -u +%F 2>/dev/null | tr -d '\r')
if [ -z "$TODAY" ]; then
  fail "could not reach the backup service."
  echo "  Refusing to update without a fresh dump."
  exit 1
fi
if ! docker compose exec -T backup rm -f /backups/.last_run 2>/dev/null; then
  fail "could not reach the backup service."
  echo "  Refusing to update without a fresh dump."
  exit 1
fi
TRIGGERED_AT=$(docker compose exec -T backup date -u +%s 2>/dev/null | tr -d '\r')
if [ -z "$TRIGGERED_AT" ]; then
  fail "could not read the clock in the backup service."
  echo "  Refusing to update without a fresh dump."
  exit 1
fi
docker compose restart backup >/dev/null 2>&1
echo "backup triggered; waiting for it to land..."
# Existence of the file proves nothing, for two reasons. pg_dump writes
# podlog-<date>.dump.partial and renames it only on success, so anything
# matching the date can be a half-written file; and if the nightly run already
# fired, yesterday's completed dump sits at the same path and would satisfy a
# presence check instantly -- handing you a rollback point from before the
# update, which is the one thing this step exists to prevent. So require a
# dump whose mtime is after we triggered the run.
DUMP="/backups/db/daily/podlog-$TODAY.dump"
dump_landed() {
  local mtime
  mtime=$(docker compose exec -T backup stat -c %Y "$DUMP" 2>/dev/null | tr -d '\r')
  [ -n "$mtime" ] && [ "$mtime" -ge "$TRIGGERED_AT" ]
}

# 30 minutes, not 60 seconds. The dump is proportional to the database, and a
# real install's is gigabytes -- this step legitimately takes minutes.
BACKUP_WAIT_SECONDS="${BACKUP_WAIT_SECONDS:-1800}"
case "$BACKUP_WAIT_SECONDS" in
  ''|*[!0-9]*) fail "BACKUP_WAIT_SECONDS must be a whole number of seconds, got: $BACKUP_WAIT_SECONDS"; exit 1 ;;
esac
elapsed=0
while ! dump_landed && [ "$elapsed" -lt "$BACKUP_WAIT_SECONDS" ]; do
  # Setting every retention tier to 0 disables backups (#682), and backup.sh
  # then returns without dumping. Nothing about that state distinguishes
  # itself from a slow dump, so without this check the update would sit here
  # for the full 30 minutes before failing. Say it immediately instead.
  if docker compose logs --tail 20 backup 2>/dev/null | grep -q 'backups disabled'; then
    fail "backups are disabled (every retention tier is 0)."
    echo "  The update runs migrations, so it will not proceed with no way back."
    echo "  Set a daily retention above 0 in Settings, then re-run."
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
  if [ $((elapsed % 30)) -eq 0 ]; then
    printf '  still dumping (%dm%02ds elapsed)\n' $((elapsed / 60)) $((elapsed % 60))
  fi
done
if dump_landed; then
  echo "dump for $TODAY is on disk"
else
  fail "no dump dated $TODAY appeared within $((BACKUP_WAIT_SECONDS / 60))m."
  echo "  Check 'docker compose logs backup'. Refusing to continue without one."
  echo "  If the dump is simply slow, re-run with a longer wait:"
  echo "    BACKUP_WAIT_SECONDS=3600 make update"
  exit 1
fi

ROLLBACK="make restore-db DATE=$TODAY"

# ---------------------------------------------------------------------------
# 3. Move
# ---------------------------------------------------------------------------
say "Moving the working copy"
BEFORE=$(git rev-parse --short HEAD)
git fetch --tags --quiet || { fail "git fetch failed"; exit 1; }

if [ -n "$PIN" ]; then
  TARGET="v${PIN#v}"
  git rev-parse -q --verify "refs/tags/$TARGET" >/dev/null || {
    fail "no such tag: $TARGET"; echo "  Available: $(git tag | tail -5 | tr '\n' ' ')"; exit 1; }
elif [ "$CHANNEL" = "edge" ]; then
  TARGET="origin/main"
else
  TARGET=$(git tag -l 'v*' --sort=-v:refname | head -1)
  [ -n "$TARGET" ] || { fail "no version tags found; nothing to update to"; exit 1; }
fi

git checkout --quiet "$TARGET" 2>/dev/null || { fail "could not check out $TARGET"; exit 1; }
AFTER=$(git rev-parse --short HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "already at $TARGET ($AFTER) — nothing to move"
else
  echo "$BEFORE -> $AFTER ($TARGET)"
fi

# ---------------------------------------------------------------------------
# 4. Images
# ---------------------------------------------------------------------------
say "Fetching images"
if [ "$CHANNEL" = "edge" ] && [ -z "$PIN" ]; then
  echo "edge builds from source"
  docker compose build || { fail "build failed"; echo "  Roll back with: $ROLLBACK"; exit 1; }
else
  docker compose pull || {
    fail "pull failed"
    echo "  The published images are linux/amd64 only. On another architecture,"
    echo "  build from source instead: make build && make up"
    echo "  Roll back the database with: $ROLLBACK"
    exit 1
  }
fi

# ---------------------------------------------------------------------------
# 5. Config drift
# ---------------------------------------------------------------------------
say "Checking configuration"
python3 scripts/env_diff.py || true   # advisory: never blocks an update

# ---------------------------------------------------------------------------
# 6. Restart
# ---------------------------------------------------------------------------
# Alembic runs on pipeline startup, so there is no separate migrate step --
# but that also means the migration happens here, which is why step 2 was
# not optional.
say "Restarting"
if [ "$CHANNEL" = "edge" ] && [ -z "$PIN" ]; then
  docker compose up -d --pull never
else
  docker compose up -d --no-build
fi
RC=$?

if [ "$RC" -ne 0 ]; then
  fail "the stack did not come up."
  echo "  Roll back with:  $ROLLBACK"
  echo "  then:            make update VERSION=<the version you were on>"
  exit 1
fi

say "Done"
echo "Now on $(cat VERSION) ($AFTER)."
echo "Watch the migration land:  docker compose logs -f pipeline"
echo "If something is wrong:     $ROLLBACK"
bash scripts/print-access.sh
