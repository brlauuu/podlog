"""Unit tests for app.services.prompts (#675).

Exercises the four public functions (get/set/reset/list) plus the
unknown-key guard, with a mocked DB session — the integration suite
exercises the SQL itself; here we keep the unit tier honest about the
control flow.
"""
from unittest.mock import MagicMock

import pytest

from app.services import prompts as svc


@pytest.fixture
def fake_db():
    db = MagicMock()
    db.execute = MagicMock()
    db.commit = MagicMock()
    return db


class TestGetPrompt:
    def test_returns_db_override_when_present(self, fake_db, monkeypatch):
        row = MagicMock(value="OVERRIDE")
        fake_db.execute.return_value.scalar_one_or_none.return_value = row

        result = svc.get_prompt(fake_db, "ask_page_system")

        assert result == "OVERRIDE"
        fake_db.execute.assert_called_once()

    def test_falls_back_to_env_default_when_no_row(self, fake_db, monkeypatch):
        fake_db.execute.return_value.scalar_one_or_none.return_value = None
        monkeypatch.setattr(svc.settings, "prompt_ask_page_system", "DEFAULT", raising=False)

        assert svc.get_prompt(fake_db, "ask_page_system") == "DEFAULT"

    def test_unknown_key_raises_keyerror(self, fake_db):
        with pytest.raises(KeyError, match="Unknown prompt key"):
            svc.get_prompt(fake_db, "no-such-key")


class TestSetPrompt:
    def test_upserts_value_and_commits(self, fake_db):
        svc.set_prompt(fake_db, "ask_page_system", "new text")
        fake_db.execute.assert_called_once()
        fake_db.commit.assert_called_once()

    def test_unknown_key_raises_keyerror(self, fake_db):
        with pytest.raises(KeyError):
            svc.set_prompt(fake_db, "bogus", "x")
        fake_db.execute.assert_not_called()
        fake_db.commit.assert_not_called()


class TestResetPrompt:
    def test_deletes_row_and_commits(self, fake_db):
        svc.reset_prompt(fake_db, "ask_episode_system")
        fake_db.execute.assert_called_once()
        fake_db.commit.assert_called_once()

    def test_unknown_key_raises_keyerror(self, fake_db):
        with pytest.raises(KeyError):
            svc.reset_prompt(fake_db, "bogus")


class TestListPrompts:
    def test_includes_every_registered_key(self, fake_db, monkeypatch):
        # No override rows — every prompt returns the env default.
        fake_db.execute.return_value.scalars.return_value.all.return_value = []
        monkeypatch.setattr(svc.settings, "prompt_ask_page_system", "PAGE", raising=False)
        monkeypatch.setattr(svc.settings, "prompt_ask_episode_system", "EP", raising=False)

        out = svc.list_prompts(fake_db)
        keys = [row["key"] for row in out]
        assert keys == ["ask_page_system", "ask_episode_system"]
        assert all(row["is_overridden"] is False for row in out)
        # The env default flows through both `value` and `default` fields.
        assert out[0]["value"] == "PAGE"
        assert out[0]["default"] == "PAGE"
        assert out[1]["value"] == "EP"

    def test_marks_overridden_rows(self, fake_db, monkeypatch):
        import datetime as dt

        override = MagicMock(
            key="ask_page_system",
            value="custom",
            updated_at=dt.datetime(2026, 5, 13, 1, 2, 3, tzinfo=dt.timezone.utc),
        )
        # Match the real signature: .key is used as the dict key
        override.key = "ask_page_system"
        fake_db.execute.return_value.scalars.return_value.all.return_value = [override]
        monkeypatch.setattr(svc.settings, "prompt_ask_page_system", "DEFAULT", raising=False)
        monkeypatch.setattr(svc.settings, "prompt_ask_episode_system", "EP_DEFAULT", raising=False)

        out = svc.list_prompts(fake_db)
        by_key = {row["key"]: row for row in out}
        assert by_key["ask_page_system"]["value"] == "custom"
        assert by_key["ask_page_system"]["default"] == "DEFAULT"
        assert by_key["ask_page_system"]["is_overridden"] is True
        assert by_key["ask_page_system"]["updated_at"] is not None
        # Unrelated keys still come back unoverridden.
        assert by_key["ask_episode_system"]["is_overridden"] is False
