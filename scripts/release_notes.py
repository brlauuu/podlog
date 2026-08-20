#!/usr/bin/env python3
"""Extract one version's section from CHANGELOG.md, and validate the release (#936).

Used by .github/workflows/release.yml on a `v*` tag push. Kept as a script
rather than inline YAML so it can be run and tested locally:

    python3 scripts/release_notes.py 1.0.0

Three checks, all of which must pass before a release is published:

1. The tag version matches the VERSION file at that commit. VERSION and the
   git tag are the only two places a version appears after #936, so this is
   the guard that keeps them honest.
2. `## Unreleased` carries no entries. A tag cut from a commit where the
   changelog was never rolled over would otherwise publish a release whose
   notes belong to the *previous* version.
3. A section exists for this version. The heading form is bare semver
   (`## 1.0.0 — YYYY-MM-DD`), not the keepachangelog reference-link form --
   #644 established that, and the About page's anchor lookup depends on it.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEADING = re.compile(r"^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$", re.M)


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}", file=sys.stderr)
    sys.exit(1)


def extract(changelog: str, version: str) -> str:
    """Return the body of the section for `version`, without its heading."""
    matches = list(HEADING.finditer(changelog))
    for i, m in enumerate(matches):
        if m.group(1) != version:
            continue
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(changelog)
        return changelog[start:end].strip()
    return ""


def unreleased_entries(changelog: str) -> list[str]:
    """Entry lines sitting under `## Unreleased`, if any."""
    m = re.search(r"^## Unreleased\s*$", changelog, re.M)
    if not m:
        return []
    nxt = HEADING.search(changelog, m.end())
    body = changelog[m.end(): nxt.start() if nxt else len(changelog)]
    return [ln for ln in body.split("\n") if ln.startswith("- ")]


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: release_notes.py <version>   (no leading 'v')")
    version = sys.argv[1].lstrip("v")

    on_disk = (ROOT / "VERSION").read_text().strip()
    if on_disk != version:
        fail(
            f"tag says {version} but VERSION says {on_disk}. "
            "The tag must be cut from a commit whose VERSION file matches it."
        )

    changelog = (ROOT / "CHANGELOG.md").read_text()

    stray = unreleased_entries(changelog)
    if stray:
        fail(
            f"## Unreleased still has {len(stray)} entr{'y' if len(stray) == 1 else 'ies'}. "
            "Graduate them into the version section before tagging, or the release "
            f"notes will be missing them. First: {stray[0][:70]}"
        )

    body = extract(changelog, version)
    if not body:
        fail(
            f"no '## {version} — YYYY-MM-DD' section in CHANGELOG.md. "
            "Headings must be bare semver with an em dash (#644)."
        )

    print(body)


if __name__ == "__main__":
    main()
