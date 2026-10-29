"""Unit tests for app.api.hardware (#822 small batch).

The service-layer helpers (detect_hardware, get_hardware_profile,
estimate_processing_times) have their own coverage in test_hardware.py.
This file covers the FastAPI route wiring at app/api/hardware.py:19–25.
"""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import hardware as api_hardware


def _client():
    app = FastAPI()
    app.include_router(api_hardware.router)
    return TestClient(app)


class TestGetHardware:
    def test_returns_payload_with_profile_present(self):
        client = _client()
        with (
            patch("app.api.hardware.detect_hardware", return_value={"cpu": "x86", "cores": 8}),
            patch(
                "app.api.hardware.get_hardware_profile",
                return_value={"name": "modest_cpu", "label": "Modest CPU"},
            ),
            patch(
                "app.api.hardware.estimate_processing_times",
                return_value={"transcription_minutes_per_hour": 120},
            ) as mock_est,
        ):
            resp = client.get("/hardware")

        assert resp.status_code == 200
        body = resp.json()
        assert body["hardware"] == {"cpu": "x86", "cores": 8}
        assert body["profile"] == "modest_cpu"
        assert body["profile_label"] == "Modest CPU"
        assert body["estimates"] == {"transcription_minutes_per_hour": 120}
        mock_est.assert_called_once_with({"name": "modest_cpu", "label": "Modest CPU"})

    def test_returns_nulls_when_no_profile(self):
        client = _client()
        with (
            patch("app.api.hardware.detect_hardware", return_value={"cpu": "arm"}),
            patch("app.api.hardware.get_hardware_profile", return_value=None),
            patch(
                "app.api.hardware.estimate_processing_times",
                return_value={"transcription_minutes_per_hour": None},
            ) as mock_est,
        ):
            resp = client.get("/hardware")

        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"] is None
        assert body["profile_label"] is None
        mock_est.assert_called_once_with(None)
