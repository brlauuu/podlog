"""Unit test configuration — ensure mock modules are available for patching."""
import os
import sys
from unittest.mock import MagicMock

# Provide required env vars so pydantic Settings() can instantiate without a .env file.
# These values are never used by unit tests — they just prevent ValidationError on import.
os.environ.setdefault("DATABASE_URL", "postgresql://localhost/podlog_test")
os.environ.setdefault("HF_TOKEN", "test-token")

# WhisperX is a heavy ML dependency not installed in the test environment.
# Provide a mock module so that patch("whisperx.load_model") etc. can resolve.
if "whisperx" not in sys.modules:
    sys.modules["whisperx"] = MagicMock()
