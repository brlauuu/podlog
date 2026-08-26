#!/usr/bin/env python3
"""Fail when a UI primitive uses a colour token the theme never defines.

Why this exists (#993): shadcn primitives style floating surfaces with
`bg-popover` / `text-popover-foreground`, but `--color-popover` was never
declared in the `@theme` block of globals.css. Tailwind silently generates
nothing for an unknown token -- no error, no warning -- so the Export
dropdown rendered with no background at all and the page showed through it.

That shipped twice. #423 reported it, #428 fixed it by swapping to
`bg-background`, and #848 reintroduced it by re-copying dropdown-menu.tsx
from upstream. Nothing caught either regression, because a missing token
looks exactly like a class that happens to have no effect.

The failure mode is specific: someone re-copies a primitive from upstream
shadcn and brings a token this project does not define. This check makes
that fail loudly at CI instead of silently at render.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLOBALS_CSS = ROOT / "apps/web/src/app/globals.css"
UI_DIR = ROOT / "apps/web/src/components/ui"

# Utility prefixes whose suffix is a colour token defined in @theme.
# Longest first: `ring-offset-background` is a ring-offset *colour* referencing
# --color-background, and must not be split as `ring-` + `offset-background`.
COLOUR_PREFIXES = (
    "ring-offset-",
    "bg-", "text-", "border-", "ring-", "fill-", "stroke-", "from-", "to-", "via-",
)

# Suffixes Tailwind provides natively, not via a project @theme token.
BUILTIN = {
    "inherit", "current", "transparent", "black", "white", "auto", "none",
    "left", "right", "center", "justify", "start", "end", "wrap", "nowrap",
    "balance", "pretty", "clip", "ellipsis", "top", "bottom", "middle",
    "solid", "dashed", "dotted", "double", "hidden", "sm", "base", "lg",
    "xl", "2xl", "3xl", "xs", "0", "1", "2", "4", "8", "px",
}

# Tailwind's default colour palette families (bg-red-500 etc.) are built in.
PALETTE = {
    "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
    "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
    "indigo", "violet", "purple", "fuchsia", "pink", "rose",
}


def defined_tokens(css: str) -> set[str]:
    """Colour tokens declared in the @theme block, minus the --color- prefix."""
    return set(re.findall(r"--color-([a-z0-9-]+)\s*:", css))


def used_tokens(source: str) -> set[str]:
    """Colour-ish utility suffixes used in className strings."""
    found: set[str] = set()
    # Class names appear inside quoted strings; split generously on whitespace
    # and Tailwind's variant separator so `dark:bg-popover` is caught too.
    for token in re.findall(r"[A-Za-z0-9_:\[\]/.\-]+", source):
        cls = token.split(":")[-1]
        for prefix in COLOUR_PREFIXES:
            if not cls.startswith(prefix):
                continue
            suffix = cls[len(prefix):]
            # The longest matching prefix IS the interpretation, so every exit
            # below breaks rather than continues. Falling through to a shorter
            # prefix is how `ring-offset-2` got re-read as `ring-` + the
            # nonexistent token `offset-2`.
            if not suffix or suffix.startswith("["):
                break
            # Strip an opacity modifier: bg-popover/50
            suffix = suffix.split("/")[0]
            if suffix in BUILTIN or suffix.split("-")[0] in PALETTE:
                break
            if suffix[0].isdigit():
                break
            found.add(suffix)
            break
    return found


def main() -> int:
    if not GLOBALS_CSS.exists():
        print(f"ERR  globals.css not found at {GLOBALS_CSS}", file=sys.stderr)
        return 1
    if not UI_DIR.is_dir():
        print(f"ERR  ui primitives not found at {UI_DIR}", file=sys.stderr)
        return 1

    known = defined_tokens(GLOBALS_CSS.read_text())
    if not known:
        print("ERR  no --color-* tokens found in @theme; refusing to pass vacuously",
              file=sys.stderr)
        return 1

    files = sorted(UI_DIR.glob("*.tsx"))
    if not files:
        print("ERR  no ui primitives found; refusing to pass vacuously", file=sys.stderr)
        return 1

    problems: list[str] = []
    for path in files:
        for suffix in sorted(used_tokens(path.read_text())):
            if suffix not in known:
                problems.append(f"{path.relative_to(ROOT)}: undefined colour token '{suffix}'")

    if problems:
        print("FAIL  UI primitives reference colour tokens missing from @theme:",
              file=sys.stderr)
        for p in problems:
            print(f"      {p}", file=sys.stderr)
        print("\n      Tailwind emits nothing for an unknown token, so this renders\n"
              "      as a missing background or colour rather than an error.\n"
              "      Define it in globals.css @theme, or use a defined token.",
              file=sys.stderr)
        return 1

    print(f"OK  {len(files)} ui primitives reference only defined colour tokens "
          f"({len(known)} in @theme)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
