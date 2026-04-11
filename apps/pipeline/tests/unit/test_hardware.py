"""Tests for hardware detection service."""
from unittest.mock import patch, mock_open

import pytest

from app.services.hardware import (
    detect_hardware,
    get_hardware_profile,
    estimate_processing_times,
    validate_fireworks_key,
    HARDWARE_PROFILES,
)


class TestDetectHardware:
    def test_parses_cpuinfo(self):
        cpuinfo = (
            "processor\t: 0\n"
            "model name\t: AMD Ryzen 7 5800X 8-Core Processor\n"
            "processor\t: 1\n"
            "model name\t: AMD Ryzen 7 5800X 8-Core Processor\n"
        )
        meminfo = "MemTotal:       32768000 kB\n"
        with patch("builtins.open", side_effect=[
            mock_open(read_data=cpuinfo)(),
            mock_open(read_data=meminfo)(),
        ]):
            with patch("app.services.hardware._check_gpu", return_value=None):
                hw = detect_hardware()
        assert hw["cpu"] == "AMD Ryzen 7 5800X 8-Core Processor"
        assert hw["cores"] == 2
        assert hw["ram_gb"] == pytest.approx(31.3, rel=0.1)
        assert hw["gpu"] is None

    def test_returns_none_when_cpuinfo_unreadable(self):
        with patch("builtins.open", side_effect=OSError("Permission denied")):
            hw = detect_hardware()
        assert hw is None

    def test_detects_gpu_when_available(self):
        cpuinfo = "processor\t: 0\nmodel name\t: Intel Core i7\n"
        meminfo = "MemTotal:       16384000 kB\n"
        with patch("builtins.open", side_effect=[
            mock_open(read_data=cpuinfo)(),
            mock_open(read_data=meminfo)(),
        ]):
            with patch("app.services.hardware._check_gpu", return_value="NVIDIA RTX 3060"):
                hw = detect_hardware()
        assert hw["gpu"] == "NVIDIA RTX 3060"


class TestGetHardwareProfile:
    def test_env_override_takes_precedence(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = "gpu-rtx3060"
            profile = get_hardware_profile()
        assert profile["name"] == "gpu-rtx3060"

    def test_env_override_unknown_profile_falls_back(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = "nonexistent-profile"
            with patch("app.services.hardware.detect_hardware", return_value=None):
                profile = get_hardware_profile()
        assert profile is None

    def test_auto_detection_matches_gpu(self):
        hw = {"cpu": "Intel i7", "cores": 8, "ram_gb": 32, "gpu": "NVIDIA RTX 3060"}
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=hw):
                profile = get_hardware_profile()
        assert profile is not None
        assert "gpu" in profile["name"]

    def test_auto_detection_matches_cpu_only(self):
        hw = {"cpu": "AMD Ryzen 7", "cores": 8, "ram_gb": 32, "gpu": None}
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=hw):
                profile = get_hardware_profile()
        assert profile is not None
        assert "cpu" in profile["name"]

    def test_returns_none_when_detection_fails(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=None):
                profile = get_hardware_profile()
        assert profile is None


class TestEstimateProcessingTimes:
    def test_returns_estimates_for_known_profile(self):
        profile = HARDWARE_PROFILES["cpu-only-8core"]
        estimates = estimate_processing_times(profile, cost_per_minute=0.006)
        assert "transcription_minutes_per_hour" in estimates
        assert "embedding_seconds_per_hour" in estimates
        assert "remote_transcription_minutes_per_hour" in estimates
        assert "remote_cost_per_hour_usd" in estimates
        assert estimates["remote_cost_per_hour_usd"] == pytest.approx(0.36, rel=0.01)

    def test_returns_remote_only_when_no_profile(self):
        estimates = estimate_processing_times(None, cost_per_minute=0.006)
        assert estimates["transcription_minutes_per_hour"] is None
        assert estimates["embedding_seconds_per_hour"] is None
        assert estimates["remote_cost_per_hour_usd"] == pytest.approx(0.36, rel=0.01)


class TestValidateFireworksKey:
    def test_returns_true_on_success(self):
        with patch("httpx.get") as mock_get:
            mock_get.return_value.status_code = 200
            result = validate_fireworks_key("fw_test_key")
        assert result is True

    def test_returns_false_on_auth_failure(self):
        with patch("httpx.get") as mock_get:
            mock_get.return_value.status_code = 401
            result = validate_fireworks_key("fw_bad_key")
        assert result is False

    def test_returns_false_on_network_error(self):
        with patch("httpx.get") as mock_get:
            mock_get.side_effect = Exception("Connection refused")
            result = validate_fireworks_key("fw_test_key")
        assert result is False
