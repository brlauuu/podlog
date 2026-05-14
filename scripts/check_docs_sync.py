#!/usr/bin/env python3
"""Docs-sync CI check (#679).

Scans agent-context docs that drift quickly — CLAUDE.md and
docs/development.md — for path mentions under top-level project
directories (apps/, prds/, docs/, scripts/, .github/) and verifies each
referenced path exists on disk. Exits non-zero with a list of missing
paths so CI fails the PR before the stale reference lands on main.

Heuristic, not a parser: we extract candidate paths via a regex that
matches the common forms in the docs (bare references, backtick-wrapped
references, parenthesized links). The regex is intentionally loose;
false-positives are filtered by simply checking the filesystem.

Usage:
    python scripts/check_docs_sync.py
    python scripts/check_docs_sync.py CLAUDE.md docs/development.md
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Top-level prefixes that we care about. Other prefixes (node_modules,
# random URLs, etc.) are deliberately ignored.
TRACKED_PREFIXES = (
    "apps/",
    "prds/",
    "docs/",
    "scripts/",
    ".github/",
)

# Greedy enough to capture nested paths, conservative enough to stop at
# whitespace / closing punctuation. Allow a trailing slash for directory
# references.
PATH_RE = re.compile(
    r"(?P<path>(?:apps|prds|docs|scripts|\.github)/[A-Za-z0-9_./-]+(?:/[A-Za-z0-9_.-]+)*)/?",
)

DEFAULT_TARGETS = ("CLAUDE.md", "docs/development.md")


def _strip_trailing_punct(token: str) -> str:
    while token and token[-1] in ".,;:)]}>\"'`":
        token = token[:-1]
    return token


def _is_template_path(p: str) -> bool:
    """Skip paths that contain a documented placeholder rather than a real
    name — these are intentionally not on disk (e.g. `docs/audit/YYYY-MM-DD/`).
    Also skip references into `node_modules/` — those resolve at install
    time, not in the working tree, and are gitignored.
    """
    if any(token in p for token in ("YYYY", "MM-DD", "<", "${")):
        return True
    if "/node_modules/" in p or p.endswith("/node_modules"):
        return True
    return False


def extract_paths(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in PATH_RE.finditer(text):
        raw = match.group("path")
        cleaned = _strip_trailing_punct(raw)
        if not cleaned.startswith(TRACKED_PREFIXES):
            continue
        if _is_template_path(cleaned):
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    return out


def check_file(doc_path: Path) -> list[str]:
    """Return the list of mentioned paths that don't exist on disk."""
    text = doc_path.read_text(encoding="utf-8")
    missing: list[str] = []
    for ref in extract_paths(text):
        target = REPO_ROOT / ref
        # Accept either file or directory existence — docs often link
        # whole folders (e.g. apps/pipeline/app/services).
        if not target.exists():
            missing.append(ref)
    return missing


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "targets",
        nargs="*",
        help="Doc files to scan (default: CLAUDE.md docs/development.md)",
    )
    args = parser.parse_args(argv)

    targets = [Path(t) for t in (args.targets or DEFAULT_TARGETS)]
    overall_missing: list[tuple[str, list[str]]] = []

    for rel in targets:
        doc_path = REPO_ROOT / rel
        if not doc_path.exists():
            print(f"::error::doc target not found: {rel}", file=sys.stderr)
            return 2
        missing = check_file(doc_path)
        if missing:
            overall_missing.append((str(rel), missing))

    if not overall_missing:
        for rel in targets:
            print(f"OK  {rel}")
        return 0

    for rel, paths in overall_missing:
        print(f"\n[FAIL] {rel} references {len(paths)} missing path(s):")
        for p in paths:
            print(f"  - {p}")
    print(
        "\nThese references are present in the doc but not on disk. "
        "Either update the doc to reflect the real layout, or add the missing files.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
