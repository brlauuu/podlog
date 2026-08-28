#!/usr/bin/env bash
#
# Report the third-party images pinned by digest, and whether the tag they
# were pinned from has since moved (#1028).
#
#   bash scripts/image_digests.sh
#
# Why this exists: pinning by digest is what stops `make update` from moving
# Postgres or Ollama underneath you, but a pin with nothing watching it is
# just a stale version nobody notices. This is the detector. It never
# changes anything -- it prints what is pinned, what the tag points at now,
# and leaves the decision to you.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

# repo:tag pairs that are pinned by digest somewhere in the compose files.
# Add a line here when you pin another third-party image.
IMAGES="pgvector/pgvector:pg15 ollama/ollama:latest"

drift=0

for ref in $IMAGES; do
  repo="${ref%:*}"
  tag="${ref##*:}"

  # Every digest this repo is pinned at, across all compose files.
  pinned=$(grep -rhoE "image: ${repo}@sha256:[0-9a-f]{64}" \
    docker-compose.yml docker-compose.test.yml docker-compose.remote.yml 2>/dev/null \
    | sed 's/.*@//' | sort -u)

  if [ -z "$pinned" ]; then
    printf '%-28s NOT PINNED -- still on a moving tag\n' "$ref"
    drift=1
    continue
  fi

  # What the tag resolves to in the registry right now. The manifest LIST
  # digest, which is what `image:` takes -- a platform-specific digest here
  # would break every architecture but the one that ran this script.
  current=$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}' 2>/dev/null)

  count=$(echo "$pinned" | grep -c .)
  if [ "$count" -gt 1 ]; then
    printf '%-28s PINNED INCONSISTENTLY across compose files:\n' "$ref"
    echo "$pinned" | sed 's/^/                             /'
    drift=1
    continue
  fi

  if [ -z "$current" ]; then
    printf '%-28s pinned %s (registry unreachable)\n' "$ref" "${pinned:0:19}"
    continue
  fi

  if [ "$pinned" = "$current" ]; then
    printf '%-28s up to date  %s\n' "$ref" "${pinned:0:19}"
  else
    printf '%-28s TAG HAS MOVED\n' "$ref"
    printf '                             pinned:  %s\n' "$pinned"
    printf '                             %-8s %s\n' "$tag:" "$current"
    drift=1
  fi
done

if [ "$drift" -ne 0 ]; then
  echo
  echo "To bump one: replace the digest in the compose file(s) with the value"
  echo "above, update the 'as of' date in the comment, and open it as a normal"
  echo "reviewed change -- a moved engine deserves a changelog line."
fi
