#!/usr/bin/env python3
"""Docs-sync CI check (#679, widened in #991).

Scans docs for path mentions under top-level project directories
(apps/, prds/, docs/, scripts/, .github/) and verifies each referenced
path exists on disk. Exits non-zero with a list of missing paths so CI
fails the PR before the stale reference lands on main.

Targets are CLAUDE.md, docs/development.md, the reference docs under
docs/, and the whole user-facing manual in docs/guide/. The manual was
outside the default targets until #991 -- 20 files that get rendered at
/docs and had none of the path checking CLAUDE.md got, which is part of
how the drift catalogued in #412 went unnoticed.

What this does NOT do, deliberately: judge whether a doc still describes
what the code does. It confirms a file exists at a path. It cannot tell
that a documented default changed last week. That check is semantic and
lives in the per-change routine in CLAUDE.md, not here -- see #991 for
why a CI gate that cannot judge correctness is worse than none.

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

def _default_targets() -> tuple[str, ...]:
    """CLAUDE.md, the reference docs, and every page of the user manual."""
    targets = ["CLAUDE.md"]
    for pattern in ("docs/*.md", "docs/guide/*.md"):
        targets.extend(
            str(p.relative_to(REPO_ROOT)) for p in sorted(REPO_ROOT.glob(pattern))
        )
    return tuple(targets)


DEFAULT_TARGETS = _default_targets()

# Bare-name listing checks (#898).
#
# The PATH_RE scan above only matches slash-bearing paths, so it silently
# passed a listing that still named a deleted module: docs/development.md
# kept `metaAnalysisColors` in its `src/lib/` listing for the whole of #870.
# These listings claim to be exhaustive, so compare them against the real
# directory in BOTH directions — a name that no longer exists is a stale
# doc, and a file missing from the list is an incomplete one.
#
# Each entry: (doc, line marker, directory, names to ignore).
LISTING_CHECKS: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    ("docs/development.md", "src/lib/", "apps/web/src/lib", frozenset({"search/*"})),
    ("CLAUDE.md", "├── api/", "apps/pipeline/app/api", frozenset()),
    ("CLAUDE.md", "├── tasks/", "apps/pipeline/app/tasks", frozenset()),
    ("CLAUDE.md", "└── services/", "apps/pipeline/app/services", frozenset()),
)

# Never treated as part of a listing — package/module scaffolding.
IGNORED_DIR_ENTRIES = frozenset({"__init__", "__pycache__"})

# Env-var documentation check (#899).
#
# README points at docs/configuration.md as "the full list of all environment
# variables", but 19 real settings were missing — including WHISPER_CPU_THREADS,
# which shipped as a new feature with no doc entry at all. pydantic-settings
# maps each Settings field to its upper-cased name, so the field list is the
# authoritative set.
CONFIG_MODULE = "apps/pipeline/app/config.py"
CONFIG_DOC = "docs/configuration.md"
CONFIG_FIELD_RE = re.compile(r"^    ([a-z][a-z0-9_]*)\s*:", re.M)

# Fields that are deliberately not user-facing configuration.
UNDOCUMENTED_CONFIG_FIELDS: frozenset[str] = frozenset()


def check_config_documented() -> list[str]:
    """Return Settings fields that docs/configuration.md never mentions."""
    module = REPO_ROOT / CONFIG_MODULE
    doc = REPO_ROOT / CONFIG_DOC
    if not module.exists() or not doc.exists():
        return [f"cannot check env vars: {CONFIG_MODULE} or {CONFIG_DOC} is missing"]
    text = doc.read_text(encoding="utf-8")
    fields = set(CONFIG_FIELD_RE.findall(module.read_text(encoding="utf-8")))
    return [
        f"{CONFIG_DOC} does not document {name.upper()} (from {CONFIG_MODULE})"
        for name in sorted(fields - UNDOCUMENTED_CONFIG_FIELDS)
        if name.upper() not in text
    ]


def _listed_names(line: str, ignore: frozenset[str]) -> set[str]:
    """Extract bare names from the parenthesized listing on `line`.

    Nested groups such as `search/* (coverage, embedding, ...)` are collapsed
    to the parent name first, so the inner members aren't mistaken for
    siblings of the outer list.
    """
    inner = re.sub(r"/\*\s*\([^)]*\)", "/*", line)
    match = re.search(r"\(([^()]*)\)\s*$", inner.rstrip())
    if not match:
        return set()
    names = {n.strip() for n in match.group(1).split(",")}
    return {n for n in names if n and n not in ignore}


def _dir_names(directory: Path) -> set[str]:
    out: set[str] = set()
    for entry in directory.iterdir():
        stem = entry.stem if entry.is_file() else entry.name
        if stem in IGNORED_DIR_ENTRIES:
            continue
        out.add(stem)
    return out


def check_listings() -> list[str]:
    """Return human-readable problems with the exhaustive listings."""
    problems: list[str] = []
    for doc, marker, dirname, ignore in LISTING_CHECKS:
        doc_path = REPO_ROOT / doc
        directory = REPO_ROOT / dirname
        if not doc_path.exists() or not directory.is_dir():
            problems.append(f"{doc}: cannot check {dirname} listing (missing doc or directory)")
            continue
        text = doc_path.read_text(encoding="utf-8")
        lines = [line for line in text.splitlines() if marker in line]
        if len(lines) != 1:
            problems.append(
                f"{doc}: expected exactly 1 line containing {marker!r} for the "
                f"{dirname} listing, found {len(lines)}"
            )
            continue
        listed = _listed_names(lines[0], ignore)
        if not listed:
            problems.append(f"{doc}: could not parse a listing from the {marker!r} line")
            continue
        actual = _dir_names(directory)
        for name in sorted(listed - actual):
            problems.append(f"{doc}: {dirname} listing names {name!r}, which is not on disk")
        for name in sorted(actual - listed):
            problems.append(f"{doc}: {dirname}/{name} exists but is missing from the listing")
    return problems


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

    # Listing checks are repo-wide rather than per-target, so only run them
    # on a default (whole-repo) invocation.
    listing_problems = [] if args.targets else check_listings()
    config_problems = [] if args.targets else check_config_documented()

    if not overall_missing and not listing_problems and not config_problems:
        for rel in targets:
            print(f"OK  {rel}")
        if not args.targets:
            print("OK  exhaustive listings")
            print("OK  env vars documented")
        return 0

    if listing_problems:
        print(f"\n[FAIL] {len(listing_problems)} listing problem(s):")
        for p in listing_problems:
            print(f"  - {p}")

    if config_problems:
        print(f"\n[FAIL] {len(config_problems)} undocumented env var(s):")
        for p in config_problems:
            print(f"  - {p}")

    for rel, paths in overall_missing:
        print(f"\n[FAIL] {rel} references {len(paths)} missing path(s):")
        for p in paths:
            print(f"  - {p}")

    # Keep the two remedies distinct — a listing problem is not necessarily a
    # missing path, and telling the reader to "add the missing files" when a
    # doc merely forgot to name an existing one sends them the wrong way.
    if overall_missing:
        print(
            "\nThese references are present in the doc but not on disk. "
            "Either update the doc to reflect the real layout, or add the missing files.",
            file=sys.stderr,
        )
    if listing_problems:
        print(
            "\nThese listings claim to be exhaustive. Update the doc so it names "
            "exactly what is on disk — in both directions.",
            file=sys.stderr,
        )
    if config_problems:
        print(
            f"\nREADME points at {CONFIG_DOC} as the full list of environment "
            "variables. Document the setting there, or add the field to "
            "UNDOCUMENTED_CONFIG_FIELDS if it is genuinely internal.",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
