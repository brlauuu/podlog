"""Integration tests for retrieve_chunks — real DB + pgvector (#695)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.models import Chunk, Episode, Feed, FeedSpeakerCache, SpeakerName


def _zero_vec(dim: int = 384) -> list[float]:
    """Vector that hits SIMILARITY_THRESHOLD when matched against itself.

    The retrieval similarity is 1 - cosine_distance. Two identical zero-ish
    vectors give similarity == 1.0, well above the 0.3 threshold.
    """
    v = [0.0] * dim
    v[0] = 1.0
    return v


@pytest.fixture
def two_episode_feed(db_session):
    """Feed with two episodes, one chunk each, both spoken by SPEAKER_00."""
    feed = Feed(id=str(uuid.uuid4()), url="https://example.com/feed.xml", title="Pod")
    db_session.add(feed)
    db_session.flush()

    ep_a = Episode(
        id=str(uuid.uuid4()), feed_id=feed.id, guid=f"a-{uuid.uuid4().hex[:6]}",
        title="Ep A", audio_url="https://example.com/a.mp3", status="done",
    )
    ep_b = Episode(
        id=str(uuid.uuid4()), feed_id=feed.id, guid=f"b-{uuid.uuid4().hex[:6]}",
        title="Ep B", audio_url="https://example.com/b.mp3", status="done",
    )
    db_session.add_all([ep_a, ep_b])
    db_session.flush()

    chunk_a = Chunk(
        episode_id=ep_a.id, speaker_label="SPEAKER_00",
        start_time=0.0, end_time=5.0, text="The market closed up today.",
        segment_ids=[1], embedding=_zero_vec(),
    )
    chunk_b = Chunk(
        episode_id=ep_b.id, speaker_label="SPEAKER_00",
        start_time=0.0, end_time=5.0, text="Different topic but same speaker.",
        segment_ids=[2], embedding=_zero_vec(),
    )
    db_session.add_all([chunk_a, chunk_b])
    db_session.flush()
    return feed, ep_a, ep_b


def test_speaker_names_overrides_per_episode(two_episode_feed, db_session, monkeypatch):
    """Baseline: when speaker_names exists for an episode, it wins."""
    feed, ep_a, _ep_b = two_episode_feed
    db_session.add(SpeakerName(
        episode_id=ep_a.id, speaker_label="SPEAKER_00",
        display_name="Jacob Shapiro", confirmed_by_user=True,
    ))
    db_session.flush()

    # Bypass the embedding model — the SQL only cares about the vector.
    from app.services import rag
    monkeypatch.setattr(rag, "embed_query", lambda *_a, **_kw: _zero_vec())

    results = rag.retrieve_chunks(db_session, "anything", feed_ids=[feed.id])
    # episode_id comes back as a UUID object; the seed used str(uuid4()).
    by_episode = {str(r.episode_id): r.speaker_label for r in results}
    assert by_episode[ep_a.id] == "Jacob Shapiro"


def test_feed_speaker_cache_falls_back_for_unrenamed_episodes(
    two_episode_feed, db_session, monkeypatch,
):
    """#695 root cause: episodes without their own speaker_names row should
    still resolve to the cached display name from a sibling episode rename."""
    feed, ep_a, ep_b = two_episode_feed

    # Only episode A has a speaker_names row …
    db_session.add(SpeakerName(
        episode_id=ep_a.id, speaker_label="SPEAKER_00",
        display_name="Jacob Shapiro", confirmed_by_user=True,
    ))
    # … but the feed-level cache covers both episodes.
    db_session.add(FeedSpeakerCache(
        feed_id=feed.id, speaker_label="SPEAKER_00",
        display_name="Jacob Shapiro",
        normalized_name="jacob shapiro",
        occurrence_count=1,
        last_seen_episode_id=ep_a.id,
        last_seen_at=datetime.now(timezone.utc),
    ))
    db_session.flush()

    from app.services import rag
    monkeypatch.setattr(rag, "embed_query", lambda *_a, **_kw: _zero_vec())

    results = rag.retrieve_chunks(db_session, "anything", feed_ids=[feed.id])
    # episode_id comes back as a UUID object; the seed used str(uuid4()).
    by_episode = {str(r.episode_id): r.speaker_label for r in results}
    # Both episodes should now resolve to the display name.
    assert by_episode[ep_a.id] == "Jacob Shapiro"
    assert by_episode[ep_b.id] == "Jacob Shapiro"


def test_feed_cache_picks_highest_occurrence_count(
    two_episode_feed, db_session, monkeypatch,
):
    """When the cache holds multiple rows per (feed, label), the LATERAL
    subquery should return the most-occurring/most-recent winner."""
    feed, _ep_a, ep_b = two_episode_feed
    older = datetime(2026, 1, 1, tzinfo=timezone.utc)
    newer = datetime(2026, 5, 1, tzinfo=timezone.utc)

    db_session.add_all([
        FeedSpeakerCache(
            feed_id=feed.id, speaker_label="SPEAKER_00",
            display_name="Jacob",
            normalized_name="jacob",
            occurrence_count=10, last_seen_at=older,
        ),
        FeedSpeakerCache(
            feed_id=feed.id, speaker_label="SPEAKER_00",
            display_name="J. Other",
            normalized_name="j other",
            occurrence_count=2, last_seen_at=newer,
        ),
    ])
    db_session.flush()

    from app.services import rag
    monkeypatch.setattr(rag, "embed_query", lambda *_a, **_kw: _zero_vec())

    results = rag.retrieve_chunks(db_session, "anything", feed_ids=[feed.id])
    # Higher occurrence_count wins even with older last_seen_at.
    for r in results:
        assert r.speaker_label == "Jacob"


def test_falls_back_to_raw_label_when_neither_table_has_a_row(
    two_episode_feed, db_session, monkeypatch,
):
    """No rename anywhere — chunks display the raw SPEAKER_NN label."""
    feed, _, _ = two_episode_feed

    from app.services import rag
    monkeypatch.setattr(rag, "embed_query", lambda *_a, **_kw: _zero_vec())

    results = rag.retrieve_chunks(db_session, "anything", feed_ids=[feed.id])
    for r in results:
        assert r.speaker_label == "SPEAKER_00"
