"""Unit tests for /api/embed endpoint."""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app

client = TestClient(app)


def test_embed_endpoint_returns_embedding_and_uses_runtime_settings():
    mock_db = MagicMock()
    app.dependency_overrides[get_db] = lambda: mock_db
    try:
        with (
            patch(
                "app.api.embed.get_runtime_embedding_settings",
                return_value={"embedding_provider": "local"},
            ) as mock_runtime,
            patch("app.services.embed.embed_query", return_value=[0.1, 0.2, 0.3]) as mock_embed,
        ):
            resp = client.post("/api/embed", json={"text": "hello world"})

        assert resp.status_code == 200
        assert resp.json() == {"embedding": [0.1, 0.2, 0.3]}
        mock_runtime.assert_called_once_with(mock_db)
        mock_embed.assert_called_once_with(
            "hello world", runtime={"embedding_provider": "local"}
        )
    finally:
        app.dependency_overrides.clear()


def test_embed_endpoint_validates_payload():
    resp = client.post("/api/embed", json={})
    assert resp.status_code == 422
