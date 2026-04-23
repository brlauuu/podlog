"""Integration tests for /api/meta-analysis endpoints (Issue #521)."""


def test_get_snapshot_returns_empty_state_when_unpopulated(api_client):
    resp = api_client.get("/api/meta-analysis/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["snapshot"] is None
    assert body["is_stale"] is True
    assert body["computed_at"] is None


def test_post_refresh_runs_synchronously_and_populates(api_client, db_session):
    resp = api_client.post("/api/meta-analysis/refresh")
    assert resp.status_code == 200
    body = resp.json()
    assert body["snapshot"] is not None
    assert "per_feed" in body["snapshot"]
    assert body["is_stale"] is False
    assert body["computed_at"] is not None


def test_get_snapshot_returns_populated_after_refresh(api_client):
    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/snapshot")
    body = resp.json()
    assert body["snapshot"] is not None
    assert body["is_stale"] is False


def test_missing_speakers_groups_by_feed(api_client, db_session):
    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/coverage/missing-speakers")
    assert resp.status_code == 200
    body = resp.json()
    assert "podcasts" in body
    for feed in body["podcasts"]:
        assert set(feed.keys()) == {"feed_id", "title", "episodes"}
