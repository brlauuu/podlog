"""API tests for /api/backups/retention (Issue #683)."""


def test_get_returns_env_defaults_initially(api_client):
    resp = api_client.get("/api/backups/retention")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["retention"].keys()) == {"daily", "weekly", "monthly"}


def test_put_persists_and_get_returns_override(api_client):
    resp = api_client.put(
        "/api/backups/retention", json={"daily": 5, "weekly": 0, "monthly": 0}
    )
    assert resp.status_code == 200
    assert resp.json()["retention"] == {"daily": 5, "weekly": 0, "monthly": 0}

    resp = api_client.get("/api/backups/retention")
    assert resp.json()["retention"] == {"daily": 5, "weekly": 0, "monthly": 0}


def test_get_backups_reflects_runtime_override(api_client):
    api_client.put(
        "/api/backups/retention", json={"daily": 1, "weekly": 0, "monthly": 0}
    )
    resp = api_client.get("/api/backups")
    assert resp.json()["retention"] == {"daily": 1, "weekly": 0, "monthly": 0}


def test_put_rejects_invalid_combo(api_client):
    resp = api_client.put(
        "/api/backups/retention", json={"daily": 0, "weekly": 4, "monthly": 0}
    )
    assert resp.status_code == 400
    assert "daily=0" in resp.json()["detail"]


def test_put_rejects_negative(api_client):
    resp = api_client.put(
        "/api/backups/retention", json={"daily": -1, "weekly": 0, "monthly": 0}
    )
    assert resp.status_code == 400


def test_all_zero_disables_backups(api_client):
    """Saving daily=weekly=monthly=0 is the explicit opt-out path."""
    api_client.put(
        "/api/backups/retention", json={"daily": 0, "weekly": 0, "monthly": 0}
    )
    resp = api_client.get("/api/backups")
    body = resp.json()
    assert body["enabled"] is False
    assert body["retention"] == {"daily": 0, "weekly": 0, "monthly": 0}
