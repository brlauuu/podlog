"""
Speaker-turn chunking service for RAG retrieval (issue #114).

Merges consecutive same-speaker segments into chunks of up to ~400 tokens.
Speaker changes are always chunk boundaries.
"""
import logging

logger = logging.getLogger(__name__)

# Target max tokens per chunk. We approximate 1 token ≈ 4 chars for English.
MAX_CHUNK_TOKENS = 400
CHARS_PER_TOKEN = 4
MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN


def merge_segments_into_chunks(
    segments: list[dict],
) -> list[dict]:
    """Merge consecutive same-speaker segments into chunks.

    Args:
        segments: List of dicts with keys: id, episode_id, speaker_label,
                  start_time, end_time, text. Must be ordered by start_time.

    Returns:
        List of chunk dicts with keys: speaker_label, start_time, end_time,
        text, segment_ids.
    """
    if not segments:
        return []

    chunks: list[dict] = []
    current: dict | None = None

    for seg in segments:
        if current is None:
            current = _new_chunk(seg)
            continue

        same_speaker = current["speaker_label"] == seg["speaker_label"]
        merged_text = current["text"] + " " + seg["text"]
        within_limit = len(merged_text) <= MAX_CHUNK_CHARS

        if same_speaker and within_limit:
            # Extend the current chunk
            current["text"] = merged_text
            current["end_time"] = seg["end_time"]
            current["segment_ids"].append(seg["id"])
        else:
            # Flush current chunk and start a new one
            chunks.append(current)
            current = _new_chunk(seg)

    if current is not None:
        chunks.append(current)

    return chunks


def _new_chunk(seg: dict) -> dict:
    return {
        "speaker_label": seg["speaker_label"],
        "start_time": seg["start_time"],
        "end_time": seg["end_time"],
        "text": seg["text"],
        "segment_ids": [seg["id"]],
    }
