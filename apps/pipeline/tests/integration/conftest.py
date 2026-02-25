"""
Integration test fixtures — requires TEST_DATABASE_URL env var.

Spins up a fresh schema per test session, rolls back per test.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

from app.models import Base, Feed, Episode

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def _require_test_db():
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — run via: make test-integration")


@pytest.fixture(scope="session")
def engine():
    _require_test_db()
    eng = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def db_session(engine) -> Session:
    """Per-test DB session wrapped in a transaction that rolls back after each test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = sessionmaker(bind=connection)()

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def sample_feed(db_session) -> Feed:
    """A feed row for FK constraints in episode tests."""
    feed = Feed(
        id=str(uuid.uuid4()),
        url="https://example.com/test-feed.xml",
        title="Test Podcast",
    )
    db_session.add(feed)
    db_session.flush()
    return feed


@pytest.fixture
def sample_episode(db_session, sample_feed) -> Episode:
    """An episode in 'pending' state, ready for download."""
    ep = Episode(
        id=str(uuid.uuid4()),
        feed_id=sample_feed.id,
        guid=f"test-guid-{uuid.uuid4().hex[:8]}",
        title="Test Episode",
        audio_url="https://example.com/audio.mp3",
        status="pending",
    )
    db_session.add(ep)
    db_session.flush()
    return ep
