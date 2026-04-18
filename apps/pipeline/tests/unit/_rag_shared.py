"""Shared helpers for the split test_rag_* test files.

Underscore prefix + non-`test_` name keeps pytest from collecting it as tests.
"""
import json

from app.services.rag import ChunkResult


def make_chunk(**overrides) -> ChunkResult:
    defaults = {
        "chunk_id": 1,
        "episode_id": "ep-1",
        "episode_title": "Test Episode",
        "speaker_label": "SPEAKER_00",
        "start_time": 65.0,
        "end_time": 90.0,
        "text": "This is a test transcript chunk.",
        "similarity": 0.85,
    }
    defaults.update(overrides)
    return ChunkResult(**defaults)


def parse_sse(text: str) -> list[dict]:
    """Parse SSE text into a list of {event, data} dicts."""
    events: list[dict] = []
    current_event = None
    current_data = None

    for line in text.strip().split("\n"):
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            raw = line[6:]
            try:
                current_data = json.loads(raw)
            except json.JSONDecodeError:
                current_data = raw
        elif line == "" and current_event is not None:
            events.append({"event": current_event, "data": current_data})
            current_event = None
            current_data = None

    if current_event is not None:
        events.append({"event": current_event, "data": current_data})

    return events
