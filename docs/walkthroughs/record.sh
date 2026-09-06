#!/usr/bin/env bash
# Record one walkthrough: terminal half under asciinema, browser half with
# Playwright, started together so the browser catches the first-run warm-up.
#
#   HF_TOKEN=hf_... bash docs/walkthroughs/record.sh install ~/podlog-fresh 3001 8001
#   bash docs/walkthroughs/record.sh update  ~/podlog-fresh 3001 8001
#
# Output lands in docs/walkthroughs/out/<scenario>.cast and
# <scenario>-browser.webm; run render.sh afterwards.
set -euo pipefail
SCENARIO="${1:?install|update}"
PODLOG_DIR="${2:?install directory}"
WEB_PORT="${3:-3000}"
API_PORT="${4:-8000}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
OUT="$here/out"
mkdir -p "$OUT"
cd "$root"

export PODLOG_DIR WEB_PORT API_PORT
asciinema rec -q --overwrite -c "bash $here/$SCENARIO.sh" "$OUT/$SCENARIO.cast" &
TERM_PID=$!

if [ "$SCENARIO" = "install" ]; then
  # Wait for the web container to answer, then start the browser half while
  # the terminal half is still waiting for the worker to warm up.
  until curl -sf -o /dev/null "http://localhost:$WEB_PORT/"; do
    kill -0 "$TERM_PID" 2>/dev/null || { echo "terminal half exited before web came up"; exit 1; }
    sleep 3
  done
  BASE_URL="http://localhost:$WEB_PORT" SCENARIO=install OUT="$OUT" node "$here/browser.mjs"
  wait "$TERM_PID"
else
  wait "$TERM_PID"
  BASE_URL="http://localhost:$WEB_PORT" SCENARIO=update OUT="$OUT" node "$here/browser.mjs"
fi
ls -la "$OUT"
