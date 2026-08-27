#!/usr/bin/env bash
#
# Run every blocking CI check locally, using CI's own commands.
#
# Point of this script: a full CI round trip is minutes, and when GitHub
# Actions is degraded it can be much longer or never. This gives the same
# answer in one command before pushing.
#
# It deliberately mirrors the workflows rather than approximating them --
# notably the coverage gates (`--cov-fail-under=82`, jest coverageThreshold),
# which are easy to miss when running pytest/jest by hand and are a common
# way a green local run turns red in CI.
#
# Known gap: CI installs the pipeline with `--without ml`, while the test
# image carries the full ML stack. A stray ML import therefore passes here
# and fails in CI. When a change touches pipeline imports, check it with:
#
#   docker run --rm -v "$PWD/apps/pipeline:/w:ro" -w /w python:3.11-slim sh -c \
#     'pip install -q poetry && poetry config virtualenvs.create false && \
#      poetry install --with dev --without ml --no-interaction --no-root -q && \
#      pytest tests/unit -q'
#
# The Pipeline Dependency Audit job is not run here: it is
# `continue-on-error: true` upstream, needs network access to the advisory
# database, and reports pre-existing CVEs that are triaged in pyproject.toml.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

FAIL=0
step() { printf '\n=== %s ===\n' "$1"; }
res()  { if [ "$1" -eq 0 ]; then echo "PASS: $2"; else echo "FAIL: $2"; FAIL=1; fi; }

# --- Drift guard -----------------------------------------------------------
# If a new job appears in a workflow, this script silently stops being an
# equivalent -- and a "PASS" here would be a claim it has not earned. Compare
# the workflow job names against the ones covered below.
COVERED="Docs sync|Pipeline Unit Fast|Web Unit Fast|Pipeline Unit Full|Web Unit Full|CHANGELOG.md updated|Pipeline Dependency Audit"
step "Workflow coverage"
UNCOVERED=$(grep -hE '^    name: ' \
              .github/workflows/ci.yml \
              .github/workflows/ci-full-unit.yml \
              .github/workflows/changelog.yml 2>/dev/null \
            | sed 's/^    name: //' \
            | grep -vE "^($COVERED)$" || true)
if [ -n "$UNCOVERED" ]; then
  echo "FAIL: workflow jobs not covered by this script:"
  echo "$UNCOVERED" | sed 's/^/       - /'
  echo "       Add them here (or to COVERED if deliberately skipped)."
  FAIL=1
else
  echo "PASS: every workflow job is accounted for"
fi

# --- Docs sync -------------------------------------------------------------
step "Docs sync"
python3 scripts/check_docs_sync.py >/dev/null 2>&1;        res $? "check_docs_sync.py"
python3 scripts/check_workflow_injection.py >/dev/null 2>&1; res $? "check_workflow_injection.py"
python3 scripts/check_ui_tokens.py >/dev/null 2>&1;          res $? "check_ui_tokens.py"

# --- Changelog -------------------------------------------------------------
# Mirrors changelog.yml, which diffs the PR against its merge-base. Compares
# committed history, so commit before running.
step "CHANGELOG.md updated"
BASE=$(git merge-base origin/main HEAD 2>/dev/null)
if [ -z "$BASE" ]; then
  echo "FAIL: no merge-base with origin/main (run: git fetch origin)"; FAIL=1
else
  git diff --name-only "$BASE" HEAD | grep -qx 'CHANGELOG.md'
  res $? "CHANGELOG.md touched since merge-base (commit first)"
fi

# --- Pipeline --------------------------------------------------------------
# The test image bakes tests in at build time (COPY . .), so a run against a
# stale image silently executes the OLD test files and reports a pass. That is
# not hypothetical: it happened on #990's own branch, where this script printed
# PASS while running the pre-change suite. Rebuild before the first pytest.
step "Rebuild test image"
docker compose -f docker-compose.test.yml build test >/dev/null 2>&1
res $? "test image rebuilt (baked-in tests are current)"

step "Pipeline Unit Fast"
docker compose -f docker-compose.test.yml run --rm test pytest \
  tests/unit/test_api.py tests/unit/test_rag_helpers.py tests/unit/test_rag_endpoint.py \
  tests/unit/test_rag_retrieval.py tests/unit/test_rag_models.py tests/unit/test_rag_streaming.py \
  tests/unit/test_notification_settings.py tests/unit/test_embed_service.py -q 2>&1 | tail -2
res ${PIPESTATUS[0]} "pipeline unit fast"

step "Pipeline Unit Full (coverage gate)"
# Written to a file rather than piped: `x=$(cmd | tail)` reports tail's exit
# status, so the coverage gate would pass silently on a pytest failure.
FULL_LOG=$(mktemp)
docker compose -f docker-compose.test.yml run --rm test \
  pytest tests/unit -q --cov=app --cov-fail-under=82 >"$FULL_LOG" 2>&1
FULL_RC=$?
tail -3 "$FULL_LOG"
res $FULL_RC "pipeline unit full + cov>=82"

# The container's build context is apps/pipeline/, so repo-root
# scripts/healthcheck.py does not exist inside it and
# test_healthcheck_script.py skips its whole module at collection time --
# 23 tests that CI runs (it checks out the whole repo) and this script did
# not. `make test-unit` already compensates by running them on the host;
# this step is the same compensation. Found when CI reported 1073 tests
# against this script's 1050.
step "Pipeline Healthcheck (host — skipped inside the container)"
python3 -m pytest apps/pipeline/tests/unit/test_healthcheck_script.py -q 2>&1 | tail -2
res ${PIPESTATUS[0]} "healthcheck script tests"

# Guard the general form of that bug: any further module that vanishes
# inside the container would be just as silent. One module-level skip is
# expected (healthcheck, covered above); more means something else is
# quietly not running here.
step "No unexpected module-level skips"
SKIPPED=$(grep -oE '[0-9]+ skipped' "$FULL_LOG" | grep -oE '^[0-9]+' | tail -1)
rm -f "$FULL_LOG"
if [ "${SKIPPED:-0}" -le 1 ]; then
  echo "PASS: $SKIPPED skipped (healthcheck module only)"
else
  echo "FAIL: $SKIPPED skipped in the container, expected 1."
  echo "      A test module is silently not running locally. Find it with:"
  echo "      docker compose -f docker-compose.test.yml run --rm test pytest tests/unit -rs"
  FAIL=1
fi

# --- Web -------------------------------------------------------------------
step "Web Unit Fast"
(cd apps/web && npx jest --runTestsByPath \
   tests/unit/notification-settings.test.tsx tests/unit/docs.test.tsx 2>&1 | tail -2)
res ${PIPESTATUS[0]} "web unit fast"

step "Web Unit Full (coverage thresholds)"
(cd apps/web && npx jest --runInBand --coverage --testPathPatterns=tests/unit 2>&1 | tail -3)
res ${PIPESTATUS[0]} "web unit full + coverage thresholds"

printf '\n================ RESULT ================\n'
if [ "$FAIL" -eq 0 ]; then
  echo "ALL BLOCKING CI CHECKS PASS LOCALLY"
else
  echo "AT LEAST ONE CHECK FAILED"
fi
exit "$FAIL"
