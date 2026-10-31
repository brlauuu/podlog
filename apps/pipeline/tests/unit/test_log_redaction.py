"""The bot token must not reach any log line (#1117 follow-up)."""
import io
import logging

import httpx
import pytest

from app import log_redaction

TOKEN = "8000000001:AAH-secret_Value-0123456789abcdefghijk"
URL = f"https://api.telegram.org/bot{TOKEN}/getUpdates"


@pytest.fixture
def root_stream():
    """A root handler like basicConfig's, with the filter installed."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(name)s %(message)s"))
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    log_redaction.install()
    yield stream
    root.removeHandler(handler)
    root.setLevel(old_level)


def test_httpx_request_line_is_redacted(root_stream):
    """The leak itself: httpx logs each request URL at INFO."""
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"ok": True}))
    with httpx.Client(transport=transport) as client:
        client.post(URL)
    out = root_stream.getvalue()
    assert "getUpdates" in out  # the line is still logged
    assert TOKEN not in out
    assert "bot<redacted>/getUpdates" in out


def test_args_are_redacted(root_stream):
    logging.getLogger("app.x").info('"error": "%s"', f"cannot reach {URL}")
    assert TOKEN not in root_stream.getvalue()


def test_traceback_is_redacted(root_stream):
    try:
        raise RuntimeError(f"failed {URL}")
    except RuntimeError:
        logging.getLogger("app.x").exception("boom")
    out = root_stream.getvalue()
    assert "RuntimeError" in out
    assert TOKEN not in out


def test_ordinary_lines_are_untouched(root_stream):
    logging.getLogger("app.x").info('"action": "%s", "n": %d', "about the robot", 3)
    assert '"action": "about the robot", "n": 3' in root_stream.getvalue()


def test_install_is_idempotent(root_stream):
    log_redaction.install()
    handler = logging.getLogger().handlers[-1]
    assert sum(isinstance(f, log_redaction.RedactBotTokenFilter) for f in handler.filters) == 1
