"""Tests for the speaker-turn chunking service (issue #114)."""
import pytest

from app.services.chunking import (
    MAX_CHUNK_CHARS,
    merge_segments_into_chunks,
)


def _seg(id, speaker, start, end, text):
    return {
        "id": id,
        "episode_id": "ep-1",
        "speaker_label": speaker,
        "start_time": start,
        "end_time": end,
        "text": text,
    }


class TestMergeSegments:
    def test_empty_input(self):
        assert merge_segments_into_chunks([]) == []

    def test_single_segment(self):
        segs = [_seg(1, "SPEAKER_00", 0.0, 5.0, "Hello world")]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 1
        assert chunks[0]["text"] == "Hello world"
        assert chunks[0]["speaker_label"] == "SPEAKER_00"
        assert chunks[0]["segment_ids"] == [1]
        assert chunks[0]["start_time"] == 0.0
        assert chunks[0]["end_time"] == 5.0

    def test_consecutive_same_speaker_merged(self):
        segs = [
            _seg(1, "SPEAKER_00", 0.0, 5.0, "Hello"),
            _seg(2, "SPEAKER_00", 5.0, 10.0, "world"),
            _seg(3, "SPEAKER_00", 10.0, 15.0, "today"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 1
        assert chunks[0]["text"] == "Hello world today"
        assert chunks[0]["segment_ids"] == [1, 2, 3]
        assert chunks[0]["start_time"] == 0.0
        assert chunks[0]["end_time"] == 15.0

    def test_speaker_change_creates_boundary(self):
        segs = [
            _seg(1, "SPEAKER_00", 0.0, 5.0, "Hi there"),
            _seg(2, "SPEAKER_01", 5.0, 10.0, "Hey"),
            _seg(3, "SPEAKER_00", 10.0, 15.0, "How are you"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 3
        assert chunks[0]["speaker_label"] == "SPEAKER_00"
        assert chunks[1]["speaker_label"] == "SPEAKER_01"
        assert chunks[2]["speaker_label"] == "SPEAKER_00"

    def test_null_speaker_treated_as_same(self):
        """Segments with None speaker_label should merge together."""
        segs = [
            _seg(1, None, 0.0, 5.0, "No speaker info"),
            _seg(2, None, 5.0, 10.0, "still none"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 1
        assert chunks[0]["text"] == "No speaker info still none"
        assert chunks[0]["speaker_label"] is None

    def test_null_to_labeled_creates_boundary(self):
        segs = [
            _seg(1, None, 0.0, 5.0, "Unlabeled"),
            _seg(2, "SPEAKER_00", 5.0, 10.0, "Labeled"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 2

    def test_max_chunk_size_splits(self):
        """Chunks exceeding MAX_CHUNK_CHARS are split even for same speaker."""
        # Create a segment that's just under the limit
        big_text = "x" * (MAX_CHUNK_CHARS - 10)
        small_text = "y" * 20  # merging would exceed limit

        segs = [
            _seg(1, "SPEAKER_00", 0.0, 60.0, big_text),
            _seg(2, "SPEAKER_00", 60.0, 65.0, small_text),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 2
        assert chunks[0]["segment_ids"] == [1]
        assert chunks[1]["segment_ids"] == [2]

    def test_many_small_segments_merge_up_to_limit(self):
        """Many small segments from the same speaker merge until limit."""
        word = "hello"  # 5 chars + 1 space per merge
        # Each merge adds len(" hello") = 6 chars
        # MAX_CHUNK_CHARS = 1600 by default
        # First segment: 5 chars, each additional adds 6 chars
        # So we can fit: 1 + (1600 - 5) // 6 = 1 + 265 = 266 segments
        n_segments = 300  # more than will fit in one chunk
        segs = [
            _seg(i, "SPEAKER_00", float(i), float(i + 1), word)
            for i in range(n_segments)
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) >= 2
        # All segment IDs should be accounted for
        all_ids = []
        for c in chunks:
            all_ids.extend(c["segment_ids"])
        assert all_ids == list(range(n_segments))

    def test_preserves_timing(self):
        segs = [
            _seg(1, "SPEAKER_00", 1.5, 3.2, "First"),
            _seg(2, "SPEAKER_00", 3.2, 7.8, "Second"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert chunks[0]["start_time"] == 1.5
        assert chunks[0]["end_time"] == 7.8

    def test_alternating_speakers(self):
        """Classic conversation pattern: alternating speakers."""
        segs = [
            _seg(1, "SPEAKER_00", 0.0, 5.0, "Question one"),
            _seg(2, "SPEAKER_01", 5.0, 10.0, "Answer one"),
            _seg(3, "SPEAKER_00", 10.0, 15.0, "Question two"),
            _seg(4, "SPEAKER_01", 15.0, 20.0, "Answer two"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 4
        for i, chunk in enumerate(chunks):
            assert chunk["segment_ids"] == [i + 1]

    def test_three_speakers(self):
        segs = [
            _seg(1, "SPEAKER_00", 0.0, 5.0, "Host speaking"),
            _seg(2, "SPEAKER_01", 5.0, 10.0, "Guest A"),
            _seg(3, "SPEAKER_02", 10.0, 15.0, "Guest B"),
            _seg(4, "SPEAKER_00", 15.0, 20.0, "Host again"),
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) == 4

    def test_long_monologue_splits_correctly(self):
        """A long monologue should be split into multiple chunks at size boundary."""
        # Each segment is 200 chars, so 8 segments = 1600 chars (at limit)
        seg_text = "a" * 200
        segs = [
            _seg(i, "SPEAKER_00", float(i * 10), float((i + 1) * 10), seg_text)
            for i in range(20)
        ]
        chunks = merge_segments_into_chunks(segs)
        assert len(chunks) > 1
        for chunk in chunks:
            assert len(chunk["text"]) <= MAX_CHUNK_CHARS
            assert chunk["speaker_label"] == "SPEAKER_00"
