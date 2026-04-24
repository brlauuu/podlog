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
    assert "episode_count" in body
    assert "feed_count" in body
    assert isinstance(body["episode_count"], int)
    assert isinstance(body["feed_count"], int)


def test_get_snapshot_returns_populated_after_refresh(api_client):
    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/snapshot")
    body = resp.json()
    assert body["snapshot"] is not None
    assert body["is_stale"] is False


def test_missing_speakers_groups_by_feed(api_client, db_session):
    from datetime import datetime, timezone
    import uuid
    from app.models import Feed, Episode

    feed = Feed(
        id=str(uuid.uuid4()),
        url="https://example.com/no-host.xml",
        title="Hostless Podcast",
    )
    db_session.add(feed)
    db_session.flush()
    ep = Episode(
        id=str(uuid.uuid4()),
        feed_id=feed.id,
        guid=f"missing-speakers-{uuid.uuid4().hex[:8]}",
        title="Mystery Episode",
        audio_url="https://example.com/audio.mp3",
        status="done",
        duration_secs=120,
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db_session.add(ep)
    db_session.commit()

    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/coverage/missing-speakers")
    assert resp.status_code == 200
    body = resp.json()
    assert "podcasts" in body
    assert len(body["podcasts"]) >= 1

    target = next(
        (p for p in body["podcasts"] if p["feed_id"] == feed.id),
        None,
    )
    assert target is not None
    assert set(target.keys()) == {"feed_id", "title", "episodes"}
    assert target["title"] == "Hostless Podcast"
    assert any(
        e["id"] == ep.id and e["reason"] == "feed has no identified host"
        for e in target["episodes"]
    )
    for e in target["episodes"]:
        assert set(e.keys()) == {"id", "title", "reason"}
