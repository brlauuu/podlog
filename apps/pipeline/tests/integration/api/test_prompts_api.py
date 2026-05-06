"""API tests for /api/prompts (Issue #643)."""
from app.config import settings


def test_get_prompts_lists_defaults(api_client):
    resp = api_client.get("/api/prompts")
    assert resp.status_code == 200
    data = resp.json()
    keys = {p["key"] for p in data["prompts"]}
    assert {"ask_page_system", "ask_episode_system"}.issubset(keys)
    page = next(p for p in data["prompts"] if p["key"] == "ask_page_system")
    assert page["is_overridden"] is False
    assert page["value"] == settings.prompt_ask_page_system


def test_put_prompt_persists_override(api_client):
    resp = api_client.put(
        "/api/prompts/ask_page_system", json={"value": "Override via API"}
    )
    assert resp.status_code == 200

    resp = api_client.get("/api/prompts")
    page = next(p for p in resp.json()["prompts"] if p["key"] == "ask_page_system")
    assert page["is_overridden"] is True
    assert page["value"] == "Override via API"


def test_put_rejects_empty_value(api_client):
    resp = api_client.put("/api/prompts/ask_page_system", json={"value": ""})
    assert resp.status_code == 400


def test_put_unknown_key_404(api_client):
    resp = api_client.put("/api/prompts/no_such_prompt", json={"value": "x"})
    assert resp.status_code == 404


def test_reset_clears_override(api_client):
    api_client.put("/api/prompts/ask_episode_system", json={"value": "override"})
    resp = api_client.post("/api/prompts/ask_episode_system/reset")
    assert resp.status_code == 200

    resp = api_client.get("/api/prompts")
    ep = next(p for p in resp.json()["prompts"] if p["key"] == "ask_episode_system")
    assert ep["is_overridden"] is False
    assert ep["value"] == settings.prompt_ask_episode_system


def test_reset_unknown_key_404(api_client):
    resp = api_client.post("/api/prompts/no_such_prompt/reset")
    assert resp.status_code == 404
