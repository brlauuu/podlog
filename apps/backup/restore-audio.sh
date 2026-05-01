#!/bin/bash
# Restore the audio archive from a dated rsync snapshot (#630).
#
# Usage (inside container — invoke via the Make target):
#   restore-audio.sh <YYYY-MM-DD>
#
# This rsyncs the snapshot back into the live audio_data volume,
# replacing whatever is there. Files newer than the snapshot are removed.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <YYYY-MM-DD>" >&2
  exit 1
fi
DATE="$1"

SNAPSHOT="/backups/audio/$DATE"
TARGET="/source/audio/archive"

if [ ! -d "$SNAPSHOT" ]; then
  echo "No audio snapshot at $SNAPSHOT" >&2
  echo "Available snapshots:" >&2
  find /backups/audio -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' \
    -printf '  %f\n' 2>/dev/null | sort | tail -n 20 >&2
  exit 1
fi

if [ ! -d "$TARGET" ]; then
  echo "Audio target missing ($TARGET) — is the audio_data volume mounted?" >&2
  exit 1
fi

echo "Restoring audio archive from $SNAPSHOT → $TARGET" >&2
rsync -a --delete "$SNAPSHOT/" "$TARGET/"
echo "Restore complete. The pipeline does not need to restart for audio." >&2
