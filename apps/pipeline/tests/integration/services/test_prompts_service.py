"""Integration tests for app.services.prompts (Issue #643)."""
import pytest

from app.config import settings
from app.services.prompts import (
    PROMPT_KEYS,
    get_prompt,
    list_prompts,
    reset_prompt,
    set_prompt,
)


def test_get_prompt_returns_env_default_when_no_override(db_session):
    """No row in prompt_settings → fall back to the env-configured default."""
    value = get_prompt(db_session, "ask_page_system")
    assert value == settings.prompt_ask_page_system


def test_set_prompt_then_get_returns_override(db_session):
    set_prompt(db_session, "ask_page_system", "Custom override text")
    assert get_prompt(db_session, "ask_page_system") == "Custom override text"


def test_set_prompt_is_idempotent_upsert(db_session):
    set_prompt(db_session, "ask_episode_system", "first")
    set_prompt(db_session, "ask_episode_system", "second")
    assert get_prompt(db_session, "ask_episode_system") == "second"


def test_reset_prompt_falls_back_to_default(db_session):
    set_prompt(db_session, "ask_page_system", "override")
    assert get_prompt(db_session, "ask_page_system") == "override"
    reset_prompt(db_session, "ask_page_system")
    assert get_prompt(db_session, "ask_page_system") == settings.prompt_ask_page_system


def test_reset_prompt_no_row_is_noop(db_session):
    reset_prompt(db_session, "ask_page_system")  # nothing to delete
    assert get_prompt(db_session, "ask_page_system") == settings.prompt_ask_page_system


def test_list_prompts_marks_overridden(db_session):
    set_prompt(db_session, "ask_page_system", "custom")
    items = {p["key"]: p for p in list_prompts(db_session)}
    assert items["ask_page_system"]["is_overridden"] is True
    assert items["ask_page_system"]["value"] == "custom"
    assert items["ask_page_system"]["default"] == settings.prompt_ask_page_system
    assert items["ask_episode_system"]["is_overridden"] is False
    assert items["ask_episode_system"]["value"] == settings.prompt_ask_episode_system


def test_list_prompts_includes_all_registered_keys(db_session):
    keys = {p["key"] for p in list_prompts(db_session)}
    assert keys == {p.key for p in PROMPT_KEYS}


def test_unknown_key_raises(db_session):
    with pytest.raises(KeyError):
        get_prompt(db_session, "no_such_prompt")
    with pytest.raises(KeyError):
        set_prompt(db_session, "no_such_prompt", "x")
    with pytest.raises(KeyError):
        reset_prompt(db_session, "no_such_prompt")
