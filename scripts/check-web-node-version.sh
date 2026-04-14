#!/usr/bin/env bash
set -euo pipefail

required_major=20
required_minor=9

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Install Node ${required_major}.${required_minor}+ and run: nvm use"
  exit 1
fi

raw_version="$(node -v 2>/dev/null || true)"
version="${raw_version#v}"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"

if [[ -z "${major:-}" || -z "${minor:-}" || ! "$major" =~ ^[0-9]+$ || ! "$minor" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Unable to parse Node.js version: ${raw_version:-unknown}"
  exit 1
fi

if (( major < required_major )) || (( major == required_major && minor < required_minor )); then
  echo "ERROR: Node.js ${raw_version} is unsupported for apps/web."
  echo "Required: >= ${required_major}.${required_minor}.0 (see .nvmrc / .node-version)."
  echo "Fix: run 'nvm use' (or install Node ${required_major}.${required_minor}+)."
  exit 1
fi

echo "Node.js version OK: ${raw_version} (required >= ${required_major}.${required_minor}.0)"
