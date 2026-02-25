"""
Shared test fixtures for the pipeline test suite.

Unit tests: no external dependencies required.
Integration tests: require TEST_DATABASE_URL env var pointing to a PostgreSQL instance.
"""
import os
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures"
FIXTURE_AUDIO = FIXTURE_DIR / "sample.mp3"


@pytest.fixture
def sample_audio_path() -> Path:
    """Path to the 10-second silent MP3 test fixture."""
    if not FIXTURE_AUDIO.exists():
        pytest.skip("Audio fixture not present — see tests/fixtures/")
    return FIXTURE_AUDIO
