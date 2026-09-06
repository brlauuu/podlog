#!/usr/bin/env bash
# Walkthrough recording 1: a fresh install (#1039).
#
#   PODLOG_DIR=~/podlog-fresh HF_TOKEN=hf_... WEB_PORT=3001 API_PORT=8001 \
#     asciinema rec -c "bash docs/walkthroughs/install.sh" install.cast
#
# Runs the real commands from docs/guide/01-installation.md against a scratch
# clone. Secrets never reach the terminal: the .env edit is shown masked.
# WEB_PORT/API_PORT exist only so a second Podlog can sit next to a running
# one; a real first install leaves the ports alone.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

: "${PODLOG_DIR:?set PODLOG_DIR to the directory to install into}"
: "${HF_TOKEN:?set HF_TOKEN (never printed)}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-8000}"
REPO="${REPO:-https://github.com/brlauuu/podlog.git}"

say "Fresh install of Podlog. Prerequisites: Docker with Compose v2, a HuggingFace token, and the pyannote licence accepted on HuggingFace."
run docker compose version

say "1. Clone, and switch to the newest released version."
run git clone --quiet "$REPO" "$PODLOG_DIR"
cd "$PODLOG_DIR"
run git checkout --quiet "$(git tag -l 'v*' --sort=-v:refname | head -1)"
run cat VERSION

say "2. Configure. Two required values: a Postgres password and your HuggingFace token."
run cp .env.example .env
PW="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
run_masked 'sed -i "s|^# POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=<strong password>|" .env' \
  sed -i -E "s|^#? ?POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|" .env
run_masked 'sed -i "s|^# HF_TOKEN=.*|HF_TOKEN=hf_...|" .env' \
  sed -i -E "s|^#? ?HF_TOKEN=.*|HF_TOKEN=$HF_TOKEN|" .env
run grep -E '^(POSTGRES_PASSWORD|HF_TOKEN)=' .env --color=never | sed -E 's/=.*/=<set>/'

if [ "$WEB_PORT" != "3000" ]; then
  say "(Recording only: this machine already runs a Podlog, so the ports move. A first install skips this.)"
  cat > docker-compose.override.yml <<YAML
services:
  web:
    ports: !override
      - "${WEB_PORT}:3000"
  pipeline:
    ports: !override
      - "127.0.0.1:${API_PORT}:8000"
  db:
    ports: !override
      - "127.0.0.1:5433:5432"
  ollama:
    ports: !override
      - "127.0.0.1:11435:11434"
YAML
  run cat docker-compose.override.yml
fi

say "3. Start from the published images. No build."
run make up-release

say "4. What is running, and where to open it."
run docker compose ps --format 'table {{.Service}}\t{{.Status}}'

say "The worker downloads about 3 GB of speech models on first boot. Health reports it as WARMING_UP until then."
run curl -s "http://localhost:${API_PORT}/api/health"
echo

say "5. The local model Ask AI uses is a separate download. Just the default one here (1.9 GB):"
run docker compose exec ollama ollama pull qwen2.5:3b

say "6. Wait for the worker to finish warming up (the queue page shows a banner meanwhile)."
wait_for "worker warming up" 1800 sh -c "curl -s http://localhost:${API_PORT}/api/health | grep -q '\"Worker\",\"status\":\"OK\"'"
run curl -s "http://localhost:${API_PORT}/api/health"
echo

say "Done. Open http://localhost:${WEB_PORT} and add your first feed. The browser recording continues from here."
