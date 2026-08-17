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
        # db is threaded through so the provenance guard reuses the request's
        # session instead of opening its own (#945).
        mock_embed.assert_called_once_with(
            "hello world", runtime={"embedding_provider": "local"}, db=mock_db
        )
    finally:
        app.dependency_overrides.clear()


def test_embed_endpoint_validates_payload():
    resp = client.post("/api/embed", json={})
    assert resp.status_code == 422


def _override_db(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db


class TestModelStateEndpoint:
    """GET /api/embed/model-state — what built the corpus vs what is configured (#945)."""

    def test_reports_a_match(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.scalar_one.return_value = 873778
        _override_db(mock_db)
        try:
            with (
                patch(
                    "app.api.embed.get_runtime_embedding_settings",
                    return_value={"embedding_provider": "local"},
                ),
                patch(
                    "app.services.embed_provenance.effective_model_name",
                    return_value="BAAI/bge-small-en-v1.5",
                ),
                patch(
                    "app.services.embed_provenance.read_state",
                    return_value={
                        "model": "BAAI/bge-small-en-v1.5",
                        "dim": 384,
                        "recorded_at": "2026-08-17T00:00:00+00:00",
                    },
                ),
            ):
                resp = client.get("/api/embed/model-state")

            assert resp.status_code == 200
            body = resp.json()
            assert body["matches"] is True
            assert body["recorded_model"] == "BAAI/bge-small-en-v1.5"
            assert body["embedded_segments"] == 873778
        finally:
            app.dependency_overrides.clear()

    def test_reports_a_mismatch(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.scalar_one.return_value = 10
        _override_db(mock_db)
        try:
            with (
                patch("app.api.embed.get_runtime_embedding_settings", return_value={}),
                patch(
                    "app.services.embed_provenance.effective_model_name",
                    return_value="all-MiniLM-L6-v2",
                ),
                patch(
                    "app.services.embed_provenance.read_state",
                    return_value={"model": "BAAI/bge-small-en-v1.5", "dim": 384},
                ),
            ):
                resp = client.get("/api/embed/model-state")

            assert resp.json()["matches"] is False
        finally:
            app.dependency_overrides.clear()

    def test_nothing_recorded_yet_is_not_a_mismatch(self):
        # A fresh install has no record; the next embed adopts one.
        mock_db = MagicMock()
        mock_db.execute.return_value.scalar_one.return_value = 0
        _override_db(mock_db)
        try:
            with (
                patch("app.api.embed.get_runtime_embedding_settings", return_value={}),
                patch(
                    "app.services.embed_provenance.effective_model_name",
                    return_value="all-MiniLM-L6-v2",
                ),
                patch("app.services.embed_provenance.read_state", return_value=None),
            ):
                resp = client.get("/api/embed/model-state")

            body = resp.json()
            assert body["recorded_model"] is None
            assert body["matches"] is True
        finally:
            app.dependency_overrides.clear()


class TestVerifyEndpoint:
    """POST /api/embed/verify — check the record against reality (#945)."""

    def test_reports_a_reproducing_model(self):
        vec = [1.0, 0.0, 0.0]
        mock_db = MagicMock()
        mock_db.execute.return_value.all.return_value = [("some text", vec)]
        _override_db(mock_db)
        try:
            with (
                patch("app.api.embed.get_runtime_embedding_settings", return_value={}),
                patch(
                    "app.services.embed_provenance.effective_model_name", return_value="m"
                ),
                patch("app.services.embed_provenance.read_state", return_value={"model": "m"}),
                patch("app.api.embed._embed_bypassing_guard", return_value=[vec]),
            ):
                resp = client.post("/api/embed/verify", json={"sample_size": 1})

            body = resp.json()
            assert body["sampled"] == 1
            assert body["mean_cosine"] == 1.0
            assert body["matches"] is True
        finally:
            app.dependency_overrides.clear()

    def test_detects_a_different_vector_space(self):
        # ~0.33 is what the wrong 384-dim model actually scored on real data.
        mock_db = MagicMock()
        mock_db.execute.return_value.all.return_value = [("some text", [1.0, 0.0, 0.0])]
        _override_db(mock_db)
        try:
            with (
                patch("app.api.embed.get_runtime_embedding_settings", return_value={}),
                patch(
                    "app.services.embed_provenance.effective_model_name", return_value="other"
                ),
                patch("app.services.embed_provenance.read_state", return_value={"model": "m"}),
                patch(
                    "app.api.embed._embed_bypassing_guard",
                    return_value=[[0.33, 0.94, 0.0]],
                ),
            ):
                resp = client.post("/api/embed/verify", json={"sample_size": 1})

            body = resp.json()
            assert body["matches"] is False
            assert body["mean_cosine"] < 0.99
            assert "does NOT reproduce" in body["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_handles_an_empty_corpus(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.all.return_value = []
        _override_db(mock_db)
        try:
            with (
                patch("app.api.embed.get_runtime_embedding_settings", return_value={}),
                patch("app.services.embed_provenance.effective_model_name", return_value="m"),
                patch("app.services.embed_provenance.read_state", return_value=None),
            ):
                resp = client.post("/api/embed/verify", json={})

            body = resp.json()
            assert body["sampled"] == 0
            assert body["matches"] is None
        finally:
            app.dependency_overrides.clear()
