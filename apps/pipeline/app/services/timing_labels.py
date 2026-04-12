"""Shared label helpers for timing/diagnostic keys."""


_ABBREVIATIONS = {
    "io": "I/O",
    "api": "API",
    "stt": "STT",
    "url": "URL",
}


def humanize_timing_key(key: str) -> str:
    """Convert machine timing keys to concise user-facing labels."""
    words = key.replace("_secs", "").replace("_", " ").strip()
    if not words:
        return key

    formatted_words = [
        _ABBREVIATIONS.get(word.lower(), word.lower())
        for word in words.split()
    ]
    label = " ".join(formatted_words)
    return label[:1].upper() + label[1:]
