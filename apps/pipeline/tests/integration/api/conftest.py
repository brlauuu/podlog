"""API integration test fixtures."""
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


@pytest.fixture
def api_client(db_session):
    """TestClient that overrides get_db with the per-test transactional session."""

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # don't close — db_session manages its own lifecycle

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
