#!/usr/bin/env bash
set -euo pipefail

export HOME="/home/brlauuu"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/bin"

REPO="/home/brlauuu/repos/podlog"
OUT_DIR="$REPO/docs/audit"
DATE_STAMP="$(date +%Y-%m-%d)"
PARTS_DIR="$OUT_DIR/parts/$DATE_STAMP"
FINAL_REPORT="$OUT_DIR/codex-$DATE_STAMP.log"
STDERR_LOG="$OUT_DIR/codex-$DATE_STAMP.stderr.log"
LOCK_DIR="$OUT_DIR/.nightly-audit.lock"

mkdir -p "$OUT_DIR" "$PARTS_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "nightly audit already running" >> "$STDERR_LOG"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

run_section() {
  local name="$1"
  local heading="$2"
  local prompt="$3"
  local outfile="$PARTS_DIR/$name.md"

  if codex exec \
    --profile nightly-audit \
    --cd "$REPO" \
    --sandbox workspace-write \
    --ask-for-approval never \
    --output-last-message "$outfile" \
    "Use \$nightly-audit. Audit focus: $heading. $prompt Output only the \"$heading\" section. Do not include the full-report summary." \
    >> "$STDERR_LOG" 2>&1
  then
    :
  else
    cat > "$outfile" <<EOF
## $heading

- **[INFO]** This audit section failed to complete
  - File: n/a
  - Evidence: codex exec failed for section '$name'; see $(basename "$STDERR_LOG")
EOF
  fi
}

run_section architecture "Architecture Review" \
  "Check structure, high-risk modules, circular dependencies, overly large files, and likely orphan modules."

run_section docs "Docs Freshness" \
  "Check README, docs/, and referenced routes, files, and commands against the current repository."

run_section tests "Test Coverage" \
  "Run safe test and coverage commands when available and summarize failures, coverage gaps, and untested risk areas."

run_section dead-code "Dead Code Detection" \
  "Look for orphan files, unused exports, dead tests, and likely unreachable code."

run_section wizard "Wizard Completeness" \
  "If the wizard spec and implementation exist, compare them and report gaps; otherwise say the section is not applicable."

run_section claude "CLAUDE.md Accuracy" \
  "If CLAUDE.md exists, compare it with the current repository and report stale or incorrect claims; otherwise say the section is not applicable."

run_section deps "Dependency Health" \
  "Check lockfiles, missing deps, likely unused deps, and packages that are clearly outdated from local tooling output."

crit_count="$(grep -Rho '\*\*\[CRITICAL\]\*\*' "$PARTS_DIR" | wc -l | tr -d ' ')"
warn_count="$(grep -Rho '\*\*\[WARNING\]\*\*' "$PARTS_DIR" | wc -l | tr -d ' ')"
info_count="$(grep -Rho '\*\*\[INFO\]\*\*' "$PARTS_DIR" | wc -l | tr -d ' ')"

overall="Good"
if [ "${crit_count:-0}" -gt 0 ]; then
  overall="Critical"
elif [ "${warn_count:-0}" -gt 0 ]; then
  overall="Needs Attention"
fi

{
  echo "# Codebase Audit — $DATE_STAMP"
  echo
  echo "## Summary"
  echo "- Overall health: $overall"
  echo "- Findings: $crit_count critical, $warn_count warnings, $info_count informational"
  echo "- Audit scope: architecture, docs freshness, test coverage, dead code, wizard completeness, CLAUDE.md accuracy, dependency health"
  echo "- Persistence model: sectioned run; partial reports live in docs/audit/parts/$DATE_STAMP/"
  echo
  cat "$PARTS_DIR/architecture.md"
  echo
  cat "$PARTS_DIR/docs.md"
  echo
  cat "$PARTS_DIR/tests.md"
  echo
  cat "$PARTS_DIR/dead-code.md"
  echo
  cat "$PARTS_DIR/wizard.md"
  echo
  cat "$PARTS_DIR/claude.md"
  echo
  cat "$PARTS_DIR/deps.md"
} > "$FINAL_REPORT"