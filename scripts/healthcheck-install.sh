#!/usr/bin/env bash
#
# Install the Podlog health check as a cron job (every 15 minutes).
# Run from the repo root: bash scripts/healthcheck-install.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEALTHCHECK="$SCRIPT_DIR/healthcheck.py"
LOG_FILE="${PODLOG_HEALTH_LOG:-/tmp/podlog-healthcheck.log}"

if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is required but not found."
    exit 1
fi

if ! command -v pg_isready &>/dev/null; then
    echo "Warning: pg_isready not found. Install postgresql-client for DB checks."
fi

CRON_LINE="*/15 * * * * python3 $HEALTHCHECK >> $LOG_FILE 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -qF "healthcheck.py"; then
    echo "Cron job already exists. Updating..."
    # Remove old entry, add new
    crontab -l 2>/dev/null | grep -vF "healthcheck.py" | { cat; echo "$CRON_LINE"; } | crontab -
else
    # Append to existing crontab
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
fi

echo "Installed cron job (every 15 minutes):"
echo "  $CRON_LINE"
echo ""
echo "Logs: $LOG_FILE"
echo ""
echo "To uninstall: crontab -e and remove the podlog-healthcheck line"
echo "To run manually: python3 $HEALTHCHECK"
