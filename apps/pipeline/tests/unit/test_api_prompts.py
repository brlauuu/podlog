"""Unit tests for app.api.prompts (#675).

Drives the FastAPI routes via TestClient with the get_db dependency
overridden to a MagicMock, and patches the service layer so the test
asserts on the HTTP contract rather than re-testing SQL.
"""
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import prompts as api_prompts
from app.database import get_db


def _client():
    app = FastAPI()
    app.include_router(api_prompts.router)
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app), db


class TestGetPrompts:
    def test_returns_list_payload(self):
        client, _ = _client()
        with patch(
            "app.api.prompts.list_prompts",
            return_value=[
                {"key": "ask_page_system", "value": "v", "default": "d", "is_overridden": False},
            ],
        ):
            resp = client.get("/prompts")
        assert resp.status_code == 200
        assert resp.json() == {
            "prompts": [
                {
                    "key": "ask_page_system",
                    "value": "v",
                    "default": "d",
                    "is_overridden": False,
                }
            ]
        }


class TestPutPrompt:
    def test_writes_through_to_set_prompt(self):
        client, _ = _client()
        with patch("app.api.prompts.set_prompt") as set_p:
            resp = client.put(
                "/prompts/ask_page_system", json={"value": "new text"}
            )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        set_p.assert_called_once()
        # The route forwards the key and value verbatim.
        _, args, _ = set_p.mock_calls[0]
        assert args[1] == "ask_page_system"
        assert args[2] == "new text"

    def test_rejects_empty_value(self):
        client, _ = _client()
        with patch("app.api.prompts.set_prompt") as set_p:
            resp = client.put("/prompts/x", json={"value": "   "})
        assert resp.status_code == 400
        assert "non-empty" in resp.json()["detail"]
        set_p.assert_not_called()

    def test_rejects_non_string_value(self):
        client, _ = _client()
        with patch("app.api.prompts.set_prompt") as set_p:
            resp = client.put("/prompts/x", json={"value": 42})
        assert resp.status_code == 400
        set_p.assert_not_called()

    def test_unknown_key_returns_404(self):
        client, _ = _client()
        with patch("app.api.prompts.set_prompt", side_effect=KeyError("bogus")):
            resp = client.put("/prompts/bogus", json={"value": "v"})
        assert resp.status_code == 404
        assert "Unknown prompt key" in resp.json()["detail"]


class TestResetPrompt:
    def test_resets_existing_key(self):
        client, _ = _client()
        with patch("app.api.prompts.reset_prompt") as reset_p:
            resp = client.post("/prompts/ask_page_system/reset")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        reset_p.assert_called_once()

    def test_unknown_key_returns_404(self):
        client, _ = _client()
        with patch("app.api.prompts.reset_prompt", side_effect=KeyError):
            resp = client.post("/prompts/bogus/reset")
        assert resp.status_code == 404
