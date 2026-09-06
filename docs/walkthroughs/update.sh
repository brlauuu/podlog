#!/usr/bin/env bash
# Walkthrough recording 2: applying an update (#1039).
#
#   PODLOG_DIR=~/podlog-fresh API_PORT=8001 \
#     asciinema rec -c "bash docs/walkthroughs/update.sh" update.cast
#
# Runs against an install that is one release behind and has a processed
# episode, so the drain and the backup have something to protect.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

: "${PODLOG_DIR:?set PODLOG_DIR to the install to update}"
API_PORT="${API_PORT:-8000}"
cd "$PODLOG_DIR"

say "This install is on $(cat VERSION). Let's move it to the newest release."
run git tag -l 'v*' --sort=-v:refname
run git status --short --branch

say "How do you learn an update exists? By default, nothing tells you: Podlog does not phone home. UPDATE_CHECK_ENABLED=true in .env adds a footer link."
run grep -nE '^#? ?UPDATE_CHECK_ENABLED' .env.example

say "make update does the whole thing: refuses on a dirty tree, drains the queue, takes a backup and refuses to continue without one, moves the working copy, pulls, reports config drift, restarts."
run make update

say "Now on $(cat VERSION). The migration ran on pipeline start:"
run docker compose logs --tail 8 pipeline
run curl -s "http://localhost:${API_PORT}/api/health"
echo

say "If anything were wrong, the rollback is the two commands the update printed: restore the dump it took, then update to the version you were on."
say "The browser recording shows the footer version and the release notes on /about."
