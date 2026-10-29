"""Unit tests for app.tasks.transcribe_helpers (#556)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.tasks.transcribe_helpers import (
    persist_transcription_artifacts,
    remove_artifacts,
)


class TestRemoveArtifacts:
    def test_unlinks_existing_files(self, tmp_path: Path):
        a = tmp_path / "a.json"
        b = tmp_path / "b.json"
        a.write_text("{}")
        b.write_text("{}")
        missing = tmp_path / "missing.json"  # never created

        remove_artifacts(a, b, missing)

        assert not a.exists()
        assert not b.exists()
        # No crash for missing file.

    def test_swallows_unlink_errors(self, tmp_path: Path):
        a = tmp_path / "a.json"
        a.write_text("{}")

        with patch.object(Path, "unlink", side_effect=OSError("locked")):
            # Should not raise.
            remove_artifacts(a)


class TestPersistTranscriptionArtifacts:
    def test_writes_the_alignment_and_returns_its_path(self, tmp_path: Path):
        aligned_path = persist_transcription_artifacts(
            transcript_dir=str(tmp_path),
            episode_id="ep-1",
            aligned_result={"segments": [1, 2]},
        )

        assert aligned_path == tmp_path / "ep-1.whisperx.json"
        assert json.loads(aligned_path.read_text()) == {"segments": [1, 2]}

    def test_creates_transcript_dir_if_missing(self, tmp_path: Path):
        target = tmp_path / "nested" / "dir"
        persist_transcription_artifacts(
            transcript_dir=str(target),
            episode_id="ep-4",
            aligned_result={"x": True},
        )
        assert (target / "ep-4.whisperx.json").exists()
