"""Shared label helpers for timing/diagnostic keys."""


def humanize_timing_key(key: str) -> str:
    """Convert machine timing keys to concise user-facing labels."""
    words = key.replace("_secs", "").replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else key
