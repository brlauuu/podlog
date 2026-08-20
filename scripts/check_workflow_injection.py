#!/usr/bin/env python3
"""Fail if any workflow interpolates ${{ }} inside a `run:` block (#937).

GitHub Actions substitutes ${{ }} into the script as *text*, before the shell
parses it. Any backtick or $() in the substituted value is then executed.

This is not theoretical here. The release workflow shipped with

    --notes "${{ steps.notes.outputs.body }}"

and its first real run executed the backticks in CHANGELOG.md -- the log shows
`make up` running on the runner (#965). The same pattern was then written a
second time, in the image-publish workflow, within the same day.

The safe form is to pass the value through `env:` and reference it as a normal
shell variable, which is never re-parsed:

    - env:
        TAGS: ${{ steps.meta.outputs.tags }}
      run: printf '%s\n' "$TAGS"

Run locally:  python3 scripts/check_workflow_injection.py
"""

import re
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"

# `run:` block, either literal-block or single-line form, up to the next key
# at the same indentation.
RUN_BLOCK = re.compile(r"^(\s+)run:\s*[|>]?-?\s*\n((?:\1\s+.*\n|\s*\n)*)", re.M)
INLINE_RUN = re.compile(r"^\s+run:\s*(?![|>])(.+)$", re.M)
EXPR = re.compile(r"\$\{\{")


def offenders(text: str) -> list[str]:
    found = []
    for m in RUN_BLOCK.finditer(text):
        for line in m.group(2).split("\n"):
            if EXPR.search(line):
                found.append(line.strip())
    for m in INLINE_RUN.finditer(text):
        if EXPR.search(m.group(1)):
            found.append(m.group(1).strip())
    return found


def main() -> None:
    problems: list[tuple[str, str]] = []
    files = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    for path in files:
        for line in offenders(path.read_text()):
            problems.append((path.name, line))

    if problems:
        print(f"[FAIL] {len(problems)} shell-interpolated expression(s):\n", file=sys.stderr)
        for name, line in problems:
            print(f"  {name}: {line[:100]}", file=sys.stderr)
        print(
            "\nPass the value through `env:` and use \"$VAR\" instead. "
            "See #965 for what happens otherwise.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"OK  no shell-interpolated expressions in {len(files)} workflow(s)")


if __name__ == "__main__":
    main()
