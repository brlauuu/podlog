"""Unit tests for scripts/healthcheck.py — state transitions and alerting logic."""
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import sys
# Import scripts/healthcheck.py from repository root
REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import healthcheck


# ---------------------------------------------------------------------------
# parse_env_file
# ---------------------------------------------------------------------------

class TestParseEnvFile:
    def test_basic_parsing(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text(
            "KEY1=value1\n"
            "KEY2=value2\n"
            "# comment\n"
            "\n"
            "KEY3=value with spaces\n"
        )
        result = healthcheck.parse_env_file(env_file)
        assert result == {"KEY1": "value1", "KEY2": "value2", "KEY3": "value with spaces"}

    def test_inline_comments(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text("PORT=5432 # postgres port\n")
        result = healthcheck.parse_env_file(env_file)
        assert result["PORT"] == "5432"

    def test_quoted_values(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text('TOKEN="abc123"\nOTHER=\'def456\'\n')
        result = healthcheck.parse_env_file(env_file)
        assert result["TOKEN"] == "abc123"
        assert result["OTHER"] == "def456"

    def test_missing_file(self, tmp_path):
        result = healthcheck.parse_env_file(tmp_path / "nonexistent")
        assert result == {}


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------

class TestStateTransitions:
    """Verify that alerts fire only on state transitions, not steady state."""

    def test_first_run_all_up_no_alert(self):
        """First run with everything healthy should not trigger any alert."""
        prev_state = {}
        results = {
            "db": ("up", "accepting connections"),
            "pipeline": ("up", "HTTP 200"),
            "web": ("up", "HTTP 200"),
            "worker": ("up", "running (healthy)"),
            "zombie_jobs": ("clear", "no zombie jobs"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert transitions == []

    def test_first_run_service_down_alerts(self):
        """First run with a service down should alert."""
        prev_state = {}
        results = {
            "db": ("down", "not ready"),
            "pipeline": ("up", "HTTP 200"),
            "web": ("up", "HTTP 200"),
            "worker": ("up", "running"),
            "zombie_jobs": ("clear", "no zombie jobs"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 1
        assert transitions[0][0] == "db"
        assert transitions[0][2] == "down"

    def test_up_to_down_transition(self):
        """Service going from up to down should trigger alert."""
        prev_state = {"db": "up", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "clear"}
        results = {
            "db": ("up", "ok"),
            "pipeline": ("down", "connection refused"),
            "web": ("up", "ok"),
            "worker": ("up", "running"),
            "zombie_jobs": ("clear", "no zombies"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 1
        assert transitions[0] == ("pipeline", "up", "down", "connection refused")

    def test_down_to_up_recovery(self):
        """Service recovering should trigger a recovery alert."""
        prev_state = {"db": "down", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "clear"}
        results = {
            "db": ("up", "accepting connections"),
            "pipeline": ("up", "ok"),
            "web": ("up", "ok"),
            "worker": ("up", "running"),
            "zombie_jobs": ("clear", "no zombies"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 1
        assert transitions[0] == ("db", "down", "up", "accepting connections")

    def test_steady_state_no_alert(self):
        """No changes should not trigger any alert."""
        prev_state = {"db": "up", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "clear"}
        results = {
            "db": ("up", "ok"),
            "pipeline": ("up", "ok"),
            "web": ("up", "ok"),
            "worker": ("up", "running"),
            "zombie_jobs": ("clear", "no zombies"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert transitions == []

    def test_steady_state_all_down_no_repeat_alert(self):
        """If everything was already down, don't re-alert."""
        prev_state = {"db": "down", "pipeline": "down", "web": "down", "worker": "down", "zombie_jobs": "clear"}
        results = {
            "db": ("down", "not ready"),
            "pipeline": ("down", "refused"),
            "web": ("down", "refused"),
            "worker": ("down", "exited"),
            "zombie_jobs": ("clear", "no zombies"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert transitions == []

    def test_zombie_detection_transition(self):
        """Zombie jobs appearing should trigger alert."""
        prev_state = {"db": "up", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "clear"}
        results = {
            "db": ("up", "ok"),
            "pipeline": ("up", "ok"),
            "web": ("up", "ok"),
            "worker": ("up", "running"),
            "zombie_jobs": ("zombies", "1 zombie job(s): job 42: transcribe (picked 2h ago)"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 1
        assert transitions[0][0] == "zombie_jobs"
        assert transitions[0][2] == "zombies"

    def test_zombie_cleared_transition(self):
        """Zombies clearing should trigger recovery alert."""
        prev_state = {"db": "up", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "zombies"}
        results = {
            "db": ("up", "ok"),
            "pipeline": ("up", "ok"),
            "web": ("up", "ok"),
            "worker": ("up", "running"),
            "zombie_jobs": ("clear", "no zombie jobs"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 1
        assert transitions[0] == ("zombie_jobs", "zombies", "clear", "no zombie jobs")

    def test_multiple_transitions(self):
        """Multiple services changing at once should all be reported."""
        prev_state = {"db": "up", "pipeline": "up", "web": "up", "worker": "up", "zombie_jobs": "clear"}
        results = {
            "db": ("down", "not ready"),
            "pipeline": ("down", "refused"),
            "web": ("up", "ok"),
            "worker": ("down", "exited"),
            "zombie_jobs": ("clear", "no zombies"),
        }
        transitions = _compute_transitions(prev_state, results)
        assert len(transitions) == 3
        services = {t[0] for t in transitions}
        assert services == {"db", "pipeline", "worker"}


# ---------------------------------------------------------------------------
# Alert formatting
# ---------------------------------------------------------------------------

class TestAlertFormatting:
    def test_down_alert_contains_service(self):
        transitions = [("pipeline", "up", "down", "connection refused")]
        msg = healthcheck.format_alert(transitions, "2026-04-03 12:00:00 UTC")
        assert "pipeline" in msg
        assert "DOWN" in msg
        assert "connection refused" in msg
        # No Markdown syntax — plain text only
        assert "*" not in msg
        assert "`" not in msg

    def test_recovery_alert(self):
        transitions = [("db", "down", "up", "accepting connections")]
        msg = healthcheck.format_alert(transitions, "2026-04-03 12:00:00 UTC")
        assert "db" in msg
        assert "RECOVERED" in msg

    def test_zombie_alert(self):
        transitions = [("zombie_jobs", "clear", "zombies", "2 zombie job(s): details")]
        msg = healthcheck.format_alert(transitions, "2026-04-03 12:00:00 UTC")
        assert "zombie_jobs" in msg
        assert "2 zombie job(s)" in msg


# ---------------------------------------------------------------------------
# State file persistence
# ---------------------------------------------------------------------------

class TestStatePersistence:
    def test_save_and_load(self, tmp_path, monkeypatch):
        state_file = tmp_path / "state.json"
        monkeypatch.setattr(healthcheck, "STATE_FILE", state_file)

        healthcheck.save_state({"db": "up", "pipeline": "down"})
        loaded = healthcheck.load_state()
        assert loaded == {"db": "up", "pipeline": "down"}

    def test_load_missing_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(healthcheck, "STATE_FILE", tmp_path / "nonexistent.json")
        assert healthcheck.load_state() == {}

    def test_load_corrupt_file(self, tmp_path, monkeypatch):
        state_file = tmp_path / "state.json"
        state_file.write_text("not json{{{")
        monkeypatch.setattr(healthcheck, "STATE_FILE", state_file)
        assert healthcheck.load_state() == {}


# ---------------------------------------------------------------------------
# Telegram credential resolution
# ---------------------------------------------------------------------------

class TestTelegramResolution:
    def test_env_values_take_priority(self):
        env = {"TELEGRAM_BOT_TOKEN": "env-token", "TELEGRAM_CHAT_ID": "env-chat"}
        with patch.object(healthcheck, "_read_telegram_from_db", return_value=("db-token", "db-chat")) as mock_db:
            token, chat_id = healthcheck.resolve_telegram_credentials(env)
        assert token == "env-token"
        assert chat_id == "env-chat"
        # Should not even call DB since both env values are present
        mock_db.assert_not_called()

    def test_falls_back_to_db(self):
        env = {}
        with patch.object(healthcheck, "_read_telegram_from_db", return_value=("db-token", "db-chat")):
            token, chat_id = healthcheck.resolve_telegram_credentials(env)
        assert token == "db-token"
        assert chat_id == "db-chat"

    def test_partial_env_partial_db(self):
        env = {"TELEGRAM_BOT_TOKEN": "env-token"}
        with patch.object(healthcheck, "_read_telegram_from_db", return_value=(None, "db-chat")):
            token, chat_id = healthcheck.resolve_telegram_credentials(env)
        assert token == "env-token"
        assert chat_id == "db-chat"

    def test_no_credentials_anywhere(self):
        env = {}
        with patch.object(healthcheck, "_read_telegram_from_db", return_value=(None, None)):
            token, chat_id = healthcheck.resolve_telegram_credentials(env)
        assert token is None
        assert chat_id is None


# ---------------------------------------------------------------------------
# Helper — extract transition logic from main() for testability
# ---------------------------------------------------------------------------

def _compute_transitions(prev_state: dict, results: dict[str, tuple[str, str]]) -> list[tuple[str, str, str, str]]:
    """Replicate the transition detection logic from main()."""
    transitions = []
    for service, (status, detail) in results.items():
        old_status = prev_state.get(service)
        if old_status is None:
            if status in ("up", "clear"):
                continue
            transitions.append((service, "unknown", status, detail))
        elif old_status != status:
            transitions.append((service, old_status, status, detail))
    return transitions


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
