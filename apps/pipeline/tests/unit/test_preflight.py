"""Tests for the diarization pre-flight (#1048)."""
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import preflight
from app.services.preflight import PreflightResult, check_hf_access, diarization_preflight

MODEL = "pyannote/speaker-diarization-community-1"


def _client(whoami: int, gate: int | None = None, *, raise_on=None):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer hf_x"
        if raise_on and raise_on in request.url.path:
            raise httpx.ConnectError("dns")
        if request.url.path == "/api/whoami-v2":
            return httpx.Response(whoami, json={"name": "me"})
        if request.url.path == f"/api/models/{MODEL}/auth-check":
            return httpx.Response(gate or 200, json={})
        raise AssertionError(f"unexpected {request.url}")

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _no_cache():
    preflight.reset_cache()
    yield
    preflight.reset_cache()


class TestCheckHfAccess:
    def test_ok_when_token_valid_and_licence_accepted(self):
        r = check_hf_access("hf_x", MODEL, client=_client(200, 200))
        assert r.status == "OK" and r.model == MODEL

    def test_missing_token(self):
        r = check_hf_access(None, MODEL, client=_client(200))
        assert r.status == "FAILED" and "HF_TOKEN is not set" in r.detail

    def test_bad_token(self):
        r = check_hf_access("hf_x", MODEL, client=_client(401))
        assert r.status == "FAILED" and "401" in r.detail

    @pytest.mark.parametrize("code", [401, 403])
    def test_licence_not_accepted(self, code):
        r = check_hf_access("hf_x", MODEL, client=_client(200, code))
        assert r.status == "FAILED"
        assert "licence" in r.detail and f"https://huggingface.co/{MODEL}" in r.detail

    def test_unknown_model(self):
        r = check_hf_access("hf_x", MODEL, client=_client(200, 404))
        assert r.status == "FAILED" and "PYANNOTE_MODEL" in r.detail

    def test_unreachable_is_unknown_not_failed(self):
        r = check_hf_access("hf_x", MODEL, client=_client(200, raise_on="whoami"))
        assert r.status == "UNKNOWN"
        r = check_hf_access("hf_x", MODEL, client=_client(200, raise_on="auth-check"))
        assert r.status == "UNKNOWN"

    def test_odd_statuses_are_unknown(self):
        assert check_hf_access("hf_x", MODEL, client=_client(503)).status == "UNKNOWN"
        assert check_hf_access("hf_x", MODEL, client=_client(200, 429)).status == "UNKNOWN"


class TestDiarizationPreflight:
    def test_skipped_for_cloud_provider(self):
        with patch.object(preflight, "get_runtime_diarization_settings", return_value={"diarization_provider": "precision2"}), \
             patch.object(preflight, "check_hf_access") as chk:
            r = diarization_preflight(MagicMock())
        assert r.status == "SKIPPED"
        chk.assert_not_called()

    def test_uses_runtime_model_and_env_token(self):
        with patch.object(preflight, "get_runtime_diarization_settings", return_value={"diarization_provider": "local", "pyannote_model": "pyannote/speaker-diarization-3.1"}), \
             patch.object(preflight.settings, "hf_token", "hf_env"), \
             patch.object(preflight, "check_hf_access", return_value=PreflightResult("OK", "fine")) as chk:
            diarization_preflight(MagicMock())
        chk.assert_called_once_with("hf_env", "pyannote/speaker-diarization-3.1")

    def test_cached_within_ttl_and_force_bypasses(self):
        with patch.object(preflight, "get_runtime_diarization_settings", return_value={"diarization_provider": "local"}), \
             patch.object(preflight, "check_hf_access", return_value=PreflightResult("OK", "fine")) as chk:
            diarization_preflight()
            diarization_preflight()
            assert chk.call_count == 1
            diarization_preflight(force=True)
            assert chk.call_count == 2

    def test_settings_lookup_failure_falls_back_to_env(self):
        with patch.object(preflight, "get_runtime_diarization_settings", side_effect=RuntimeError("db")), \
             patch.object(preflight.settings, "diarization_provider", "local"), \
             patch.object(preflight, "check_hf_access", return_value=PreflightResult("OK", "fine")) as chk:
            assert diarization_preflight().status == "OK"
        chk.assert_called_once()


class TestWorkerStartupWarning:
    def test_warns_on_failure_with_detail(self):
        import app.worker as worker_mod

        failed = PreflightResult("FAILED", "licence not accepted", MODEL)
        with patch("app.services.preflight.diarization_preflight", return_value=failed), \
             patch.object(worker_mod.logger, "warning") as warn, \
             patch.object(worker_mod.logger, "info"):
            worker_mod._warn_if_diarization_preflight_fails()
        assert warn.call_count == 1
        assert "diarization_preflight_failed" in warn.call_args[0][0]
        assert "licence not accepted" in warn.call_args[0][2]

    def test_info_only_when_ok(self):
        import app.worker as worker_mod

        with patch("app.services.preflight.diarization_preflight", return_value=PreflightResult("OK", "fine", MODEL)), \
             patch.object(worker_mod.logger, "warning") as warn:
            worker_mod._warn_if_diarization_preflight_fails()
        warn.assert_not_called()

    def test_never_blocks_startup(self):
        import app.worker as worker_mod

        with patch("app.services.preflight.diarization_preflight", side_effect=RuntimeError("boom")), \
             patch.object(worker_mod.logger, "warning") as warn:
            worker_mod._warn_if_diarization_preflight_fails()
        assert "diarization_preflight_check_failed" in warn.call_args[0][0]


class TestHealthEndpoint:
    def _mock_db(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = MagicMock(value="1")
        return db

    def _get(self, result):
        from fastapi.testclient import TestClient
        from app.main import app

        ollama = MagicMock(status_code=200)
        with patch("app.api.health.SessionLocal", return_value=self._mock_db()), \
             patch("app.api.health.httpx.get", return_value=ollama), \
             patch("app.api.health.diarization_preflight", return_value=result):
            return TestClient(app).get("/api/health").json()

    def _svc(self, payload):
        return next(s for s in payload["services"] if s["name"] == "Diarization")

    def test_failed_degrades_health_with_detail(self):
        payload = self._get(PreflightResult("FAILED", "licence not accepted", MODEL))
        assert payload["status"] == "DEGRADED"
        assert self._svc(payload) == {"name": "Diarization", "status": "DEGRADED", "detail": "licence not accepted"}

    @pytest.mark.parametrize("status", ["OK", "UNKNOWN", "SKIPPED"])
    def test_other_states_keep_health_ok(self, status):
        payload = self._get(PreflightResult(status, "x", MODEL))
        assert payload["status"] == "OK"
        assert self._svc(payload)["status"] == "OK"
        assert self._svc(payload)["detail"] == "x"

    def test_check_error_never_takes_health_down(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.health.SessionLocal", return_value=self._mock_db()), \
             patch("app.api.health.httpx.get", return_value=MagicMock(status_code=200)), \
             patch("app.api.health.diarization_preflight", side_effect=RuntimeError("boom")):
            payload = TestClient(app).get("/api/health").json()
        assert payload["status"] == "OK"
        assert self._svc(payload)["detail"] == "pre-flight check errored"
