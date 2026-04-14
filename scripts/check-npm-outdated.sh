#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d "apps/web" || ! -f "apps/web/package.json" ]]; then
  echo "ERROR: run this script from the repository root."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed."
  exit 1
fi

out_file="$(mktemp)"
err_file="$(mktemp)"
trap 'rm -f "$out_file" "$err_file"' EXIT

set +e
(
  cd apps/web
  npm_config_fetch_timeout=5000 \
  npm_config_fetch_retries=0 \
  npm outdated --long >"$out_file" 2>"$err_file"
)
status=$?
set -e

if [[ $status -eq 0 ]]; then
  if [[ -s "$out_file" ]]; then
    cat "$out_file"
  else
    echo "All npm packages are up to date."
  fi
  exit 0
fi

if [[ -s "$out_file" ]]; then
  # npm outdated exits with code 1 when outdated packages are found.
  cat "$out_file"
  exit 0
fi

if grep -Eiq "(EAI_AGAIN|ENOTFOUND|ETIMEDOUT|getaddrinfo)" "$err_file"; then
  echo "Skipped npm outdated due to transient network/DNS failure."
  echo "Retry later or run this check in CI/networked environment."
  exit 0
fi

cat "$err_file" >&2
exit "$status"
