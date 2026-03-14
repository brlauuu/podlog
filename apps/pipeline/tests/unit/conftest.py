"""Unit test configuration — ensure mock modules are available for patching."""
import sys
from unittest.mock import MagicMock

# WhisperX is a heavy ML dependency not installed in the test environment.
# Provide a mock module so that patch("whisperx.load_model") etc. can resolve.
if "whisperx" not in sys.modules:
    sys.modules["whisperx"] = MagicMock()
