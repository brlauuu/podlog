"""
Helper utilities for host/guest inference text processing and matching.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from io import StringIO
from typing import Optional

# Proximity window (in characters) for guest signal detection
GUEST_PROXIMITY_CHARS = 200

GUEST_SIGNAL_PATTERNS = [
    r"\bguest\b",
    r"\bjoin(?:s|ing|ed)?\b",
    r"\btoday'?s guest\b",
    r"\bfeaturing\b",
    r"\bfeat\.?\b",
    r"\binterview(?:s|ing|ed)?\b",
    r"\bsit(?:s|ting)? down with\b",
    r"\btalk(?:s|ing)? to\b",
    r"\bwelcome(?:s|d)?\b",
    r"\bwith me today\b",
    r"\bmy guest\b",
    r"\bspecial guest\b",
]

HOST_DESCRIPTION_PATTERNS = [
    r"\bhosted by\b",
    r"\bhost of\b",
    r"\byour host\b",
    r"\bI'?m\b",
]

# Episode-number prefixes stripped before NER (PRD-04 E2). The number is
# followed by a separator (`:`, `-`, `—`, `–`, `|`) to avoid swallowing
# title fragments like "1984 Orwell revisited". We match at the start of
# the string only.
_EPISODE_PREFIX_RE = re.compile(
    r"^\s*(?:ep(?:isode)?\.?\s*\d+|#\s*\d+|\d+)\s*[:\-—–|]\s*",
    re.IGNORECASE,
)


class _HTMLStripper(HTMLParser):
    """Minimal HTML tag stripper."""

    def __init__(self):
        super().__init__()
        self._text = StringIO()

    def handle_data(self, data):
        self._text.write(data)

    def get_text(self) -> str:
        return self._text.getvalue()


def strip_html(text: str) -> str:
    """Strip HTML tags from text (PRD-04 L-05)."""
    stripper = _HTMLStripper()
    stripper.feed(text)
    return stripper.get_text()


_HONORIFICS = frozenset(
    {"dr", "mr", "mrs", "ms", "mx", "prof", "sir", "madam", "rev", "fr", "sr", "st"}
)


def normalize_name(name: str) -> str:
    """Lowercase, collapse whitespace, and strip leading honorifics for dedupe.

    Makes "Dr. Jane Smith" and "Jane Smith" compare as the same person so the
    metadata and NER candidate lists dedupe correctly.
    """
    lowered = " ".join(name.lower().split())
    if not lowered:
        return lowered
    tokens = lowered.split(" ")
    # Strip leading honorifics (possibly with trailing punctuation) until a
    # non-honorific token remains. Leaves 1-token names alone.
    while len(tokens) > 1:
        head = tokens[0].rstrip(".,:")
        if head in _HONORIFICS:
            tokens.pop(0)
        else:
            break
    return " ".join(tokens)


def name_near_host_pattern(name_lower: str, feed_desc_lower: str) -> bool:
    """Check if name appears near host-signal phrases in feed description."""
    for pattern in HOST_DESCRIPTION_PATTERNS:
        for m in re.finditer(pattern, feed_desc_lower):
            start = max(0, m.start() - GUEST_PROXIMITY_CHARS)
            end = min(len(feed_desc_lower), m.end() + GUEST_PROXIMITY_CHARS)
            window = feed_desc_lower[start:end]
            if name_lower in window:
                return True
    return False


def name_near_guest_signal(name_lower: str, ep_desc_lower: str) -> Optional[str]:
    """Check if name appears near guest-signal phrases. Returns confidence or None."""
    strong_patterns = [r"\bmy guest\b", r"\btoday'?s guest\b", r"\bspecial guest\b"]
    for pattern in GUEST_SIGNAL_PATTERNS:
        for m in re.finditer(pattern, ep_desc_lower):
            start = max(0, m.start() - GUEST_PROXIMITY_CHARS)
            end = min(len(ep_desc_lower), m.end() + GUEST_PROXIMITY_CHARS)
            window = ep_desc_lower[start:end]
            if name_lower in window:
                is_strong = any(re.search(sp, window) for sp in strong_patterns)
                return "HIGH" if is_strong else "MEDIUM"
    return None


def name_after_colon_in_title(name: str, text: str) -> bool:
    """Check for 'Ep N: Name ...' pattern in the first line of the given text.

    Used against both the first line of the episode description (legacy) and
    the episode title itself (PRD-04 E1 — many feeds carry the guest name
    only in the title, never in the description body).
    """
    if not text:
        return False
    first_line = text.split("\n")[0]
    if ":" not in first_line:
        return False
    after_colon = first_line.split(":", 1)[1].strip()
    return name.lower() in after_colon.lower()


def strip_episode_prefix(text: str) -> str:
    """Remove leading 'Ep 42:' / '#42 —' / '42 |' prefixes before NER (PRD-04 E2).

    Some transformer NER models treat these tokens as part of a preceding
    entity span, dropping the true name. Stripping the prefix before the
    model sees the text reliably isolates the name. Only `:`, `-`, `—`, `–`,
    and `|` are treated as separators — `.` is intentionally excluded to
    avoid over-stripping titles like "1984. Orwell revisited".
    """
    if not text:
        return text
    return _EPISODE_PREFIX_RE.sub("", text, count=1)
