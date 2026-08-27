#!/usr/bin/env python3
"""Compare .env against .env.example and report drift (#937, phase 3).

Run directly, or as part of `make update`:

    python3 scripts/env_diff.py            # compares ./.env against ./.env.example
    python3 scripts/env_diff.py --quiet    # exit status only, for scripting

WHY THIS NEVER WRITES

`.env` holds the operator's secrets -- Postgres password, Fireworks and
pyannote API keys, Telegram tokens. A tool that edits it during an update is
one bug away from truncating them, and a backup of the database does not
bring them back. So this reports and exits; applying anything is the
operator's keystroke.

WHAT COUNTS AS DRIFT

Commented-out keys in .env.example are documentation of optional settings,
not requirements -- most of the file is commented by design. Only keys that
appear uncommented in the example are treated as expected. A key set in .env
but absent from the example is reported separately and is usually harmless:
either a setting that was retired upstream, or one the operator added.

Exit status is 1 when a key expected by the example is missing from .env,
0 otherwise -- including when the only finding is extra keys.
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# KEY=value, with optional leading whitespace. Captures whether it was
# commented out, because that distinction is the whole point above.
LINE = re.compile(r"^(?P<comment>#\s*)?(?P<key>[A-Z][A-Z0-9_]*)=")


def parse_keys(text: str) -> tuple[set[str], set[str]]:
    """Return (uncommented keys, commented-out keys)."""
    live: set[str] = set()
    commented: set[str] = set()
    for line in text.splitlines():
        m = LINE.match(line.strip())
        if not m:
            continue
        (commented if m.group("comment") else live).add(m.group("key"))
    return live, commented


def diff(env_text: str, example_text: str) -> tuple[list[str], list[str]]:
    """Return (missing from .env, present in .env but not the example)."""
    env_live, _ = parse_keys(env_text)
    ex_live, ex_commented = parse_keys(example_text)

    missing = sorted(ex_live - env_live)
    # A commented-out example key is optional, so an env key matching one is
    # not "unknown" -- it is someone taking up the offer.
    unknown = sorted(env_live - ex_live - ex_commented)
    return missing, unknown


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--env", default=str(ROOT / ".env"))
    ap.add_argument("--example", default=str(ROOT / ".env.example"))
    ap.add_argument("--quiet", action="store_true", help="exit status only")
    args = ap.parse_args()

    env_path, example_path = Path(args.env), Path(args.example)
    if not example_path.exists():
        print(f"[FAIL] no {example_path}", file=sys.stderr)
        return 2
    if not env_path.exists():
        print(f"[FAIL] no {env_path} — copy .env.example and fill it in", file=sys.stderr)
        return 2

    missing, unknown = diff(env_path.read_text(), example_path.read_text())

    if not args.quiet:
        if missing:
            print("Settings .env.example lists that your .env does not set:")
            for k in missing:
                print(f"  + {k}")
            print(
                "\n  Not necessarily a problem: many of these have a working default\n"
                "  in the app, and the example is showing you the knob rather than\n"
                "  requiring it. Read the comment above each in .env.example to tell.\n"
                "  Add any you want by hand — this script never edits .env, which\n"
                "  holds your passwords and API keys."
            )
        if unknown:
            print("\nSettings in your .env that the example no longer lists:")
            for k in unknown:
                print(f"  - {k}")
            print("\n  Usually harmless: either retired upstream, or something you added.")
        if not missing and not unknown:
            print("No configuration drift.")

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
