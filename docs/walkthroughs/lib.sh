#!/usr/bin/env bash
# Narrated-command helpers for the walkthrough recordings (#1039).
# Sourced by install.sh and update.sh; run those under `asciinema rec -c`.
#
#   say  "text"        prints a narration line, pauses so it can be read
#   run  cmd args...   prints the command as typed, pauses, runs it
#   run_masked "shown" cmd args...   same, but prints "shown" instead of the
#                                    real command (for lines carrying secrets)
#
# PACE=0 makes every pause instant (dry runs).
PACE="${PACE:-1}"
# asciinema hands the script a real terminal, so anything that pages would
# sit waiting for a keypress nobody will give it.
export PAGER=cat GIT_PAGER=cat LESS=FRX GIT_TERMINAL_PROMPT=0
pause() { [ "$PACE" = "0" ] || sleep "$1"; }

say() {
  printf '\n\033[1;36m# %s\033[0m\n' "$1"
  pause 2.5
}

run() {
  printf '\033[1;32m$\033[0m %s\n' "$*"
  pause 1.2
  "$@"
  local rc=$?
  pause 1.5
  return $rc
}

run_masked() {
  local shown="$1"; shift
  printf '\033[1;32m$\033[0m %s\n' "$shown"
  pause 1.2
  "$@"
  local rc=$?
  pause 1.5
  return $rc
}

wait_for() {  # wait_for "label" seconds cmd...   polls cmd until it succeeds
  local label="$1" limit="$2"; shift 2
  local t=0
  printf '\033[1;33m… %s\033[0m' "$label"
  until "$@" >/dev/null 2>&1; do
    sleep 5; t=$((t + 5)); printf '.'
    [ "$t" -ge "$limit" ] && { printf ' (gave up after %ss)\n' "$limit"; return 1; }
  done
  printf ' %ss\n' "$t"
}
