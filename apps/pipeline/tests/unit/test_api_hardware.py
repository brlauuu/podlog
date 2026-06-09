"""Unit tests for app.api.hardware (#822 small batch).

The service-layer helpers (detect_hardware, get_hardware_profile,
estimate_processing_times) have their own coverage in test_hardware.py.
This file covers the FastAPI route wiring at app/api/hardware.py:19–25.
"""
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import hardware as api_hardware
from app.database import get_db


def _client():
    app = FastAPI()
    app.include_router(api_hardware.router)
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app), db


class TestGetHardware:
    def test_returns_payload_with_profile_present(self):
        client, _ = _client()
        with (
            patch("app.api.hardware.detect_hardware", return_value={"cpu": "x86", "cores": 8}),
            patch(
                "app.api.hardware.get_hardware_profile",
                return_value={"name": "modest_cpu", "label": "Modest CPU"},
            ),
            patch(
                "app.api.hardware.get_notification_settings",
                return_value={"fireworks_stt_cost_per_minute_usd": 0.008},
            ),
            patch(
                "app.api.hardware.estimate_processing_times",
                return_value={"transcribe_secs": 120, "diarize_secs": 30},
            ) as mock_est,
        ):
            resp = client.get("/hardware")

        assert resp.status_code == 200
        body = resp.json()
        assert body["hardware"] == {"cpu": "x86", "cores": 8}
        assert body["profile"] == "modest_cpu"
        assert body["profile_label"] == "Modest CPU"
        assert body["estimates"] == {"transcribe_secs": 120, "diarize_secs": 30}
        # The settings-supplied cost-per-minute was forwarded to the estimator.
        mock_est.assert_called_once_with(
            {"name": "modest_cpu", "label": "Modest CPU"},
            0.008,
        )

    def test_returns_nulls_when_no_profile(self):
        client, _ = _client()
        with (
            patch("app.api.hardware.detect_hardware", return_value={"cpu": "arm"}),
            patch("app.api.hardware.get_hardware_profile", return_value=None),
            patch(
                "app.api.hardware.get_notification_settings",
                return_value={},
            ),
            patch(
                "app.api.hardware.estimate_processing_times",
                return_value={"transcribe_secs": None},
            ) as mock_est,
        ):
            resp = client.get("/hardware")

        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"] is None
        assert body["profile_label"] is None
        # When the notification settings omit the cost key, the route
        # falls back to the documented default of 0.006 $/min.
        mock_est.assert_called_once_with(None, 0.006)
