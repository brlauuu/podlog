"""Unit test configuration — ensure mock modules are available for patching."""
import os
import sys
from unittest.mock import MagicMock

import pytest

# Provide required env vars so pydantic Settings() can instantiate without a .env file.
# These values are never used by unit tests — they just prevent ValidationError on import.
os.environ.setdefault("DATABASE_URL", "postgresql://localhost/podlog_test")
os.environ.setdefault("HF_TOKEN", "test-token")

# WhisperX is a heavy ML dependency not installed in the test environment.
# Provide a mock module so that patch("whisperx.load_model") etc. can resolve.
if "whisperx" not in sys.modules:
    sys.modules["whisperx"] = MagicMock()
if "faster_whisper" not in sys.modules:
    sys.modules["faster_whisper"] = MagicMock()


@pytest.fixture(autouse=True)
def _restore_settings_fields_set():
    """Undo what patching the settings singleton leaves in model_fields_set (#1100).

    Pydantic adds a field to model_fields_set on every assignment, and
    patch.object restores the value but not the set. Production code reads the
    set to tell a value from env or .env apart from a default
    (services/remote_retirement.py), so a leaked field changes behaviour in
    whichever test runs next.
    """
    from app.config import settings

    saved = set(settings.model_fields_set)
    yield
    object.__setattr__(settings, "__pydantic_fields_set__", saved)
