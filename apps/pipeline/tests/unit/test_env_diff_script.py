"""Unit tests for scripts/env_diff.py — the config-drift report (#937 phase 3).

Imported the same way test_healthcheck_script.py imports healthcheck.py:
walk up for the repo root, since the depth differs between host and Docker.
"""
import sys
from pathlib import Path

import pytest

_here = Path(__file__).resolve()
REPO_ROOT = None
for parent in _here.parents:
    if (parent / "scripts" / "env_diff.py").exists():
        REPO_ROOT = parent
        break

if REPO_ROOT is None:
    pytest.skip("Cannot locate repo root with scripts/env_diff.py", allow_module_level=True)

sys.path.insert(0, str(REPO_ROOT / "scripts"))
import env_diff  # noqa: E402


class TestParseKeys:
    def test_separates_live_keys_from_commented_ones(self):
        live, commented = env_diff.parse_keys(
            "A=1\n# B=2\n#C=3\n   D=4\n"
        )
        assert live == {"A", "D"}
        assert commented == {"B", "C"}

    def test_ignores_prose_and_blank_lines(self):
        live, commented = env_diff.parse_keys(
            "# Some explanation about things\n\n"
            "# ---------------------------------\n"
            "REAL=1\n"
        )
        assert live == {"REAL"}
        assert commented == set()

    def test_a_value_containing_an_equals_sign_is_still_one_key(self):
        live, _ = env_diff.parse_keys("DATABASE_URL=postgres://u:p@h/db?a=b\n")
        assert live == {"DATABASE_URL"}


class TestDiff:
    def test_reports_a_key_the_example_sets_and_env_does_not(self):
        missing, unknown = env_diff.diff(env_text="A=1\n", example_text="A=1\nB=2\n")
        assert missing == ["B"]
        assert unknown == []

    def test_a_commented_example_key_is_optional_not_missing(self):
        # Most of .env.example is commented out on purpose -- it documents
        # optional settings. Treating those as required would report drift on
        # a perfectly normal install.
        missing, unknown = env_diff.diff(env_text="A=1\n", example_text="A=1\n# B=2\n")
        assert missing == []

    def test_taking_up_an_optional_setting_is_not_unknown(self):
        missing, unknown = env_diff.diff(env_text="A=1\nB=2\n", example_text="A=1\n# B=2\n")
        assert missing == []
        assert unknown == []

    def test_reports_a_key_the_example_no_longer_mentions(self):
        missing, unknown = env_diff.diff(env_text="A=1\nOLD=2\n", example_text="A=1\n")
        assert missing == []
        assert unknown == ["OLD"]

    def test_clean_install_reports_nothing(self):
        missing, unknown = env_diff.diff(env_text="A=1\nB=2\n", example_text="A=1\nB=2\n")
        assert (missing, unknown) == ([], [])


class TestExitStatus:
    """A missing key fails; extra keys alone do not.

    `make update` runs this and must not abort an otherwise fine update
    because the operator kept a setting we retired.
    """

    def _run(self, tmp_path, env_text, example_text, monkeypatch):
        env = tmp_path / ".env"
        example = tmp_path / ".env.example"
        env.write_text(env_text)
        example.write_text(example_text)
        monkeypatch.setattr(
            sys, "argv",
            ["env_diff.py", "--env", str(env), "--example", str(example), "--quiet"],
        )
        return env_diff.main()

    def test_missing_key_exits_nonzero(self, tmp_path, monkeypatch):
        assert self._run(tmp_path, "A=1\n", "A=1\nB=2\n", monkeypatch) == 1

    def test_extra_key_alone_exits_zero(self, tmp_path, monkeypatch):
        assert self._run(tmp_path, "A=1\nOLD=2\n", "A=1\n", monkeypatch) == 0

    def test_clean_exits_zero(self, tmp_path, monkeypatch):
        assert self._run(tmp_path, "A=1\n", "A=1\n", monkeypatch) == 0

    def test_missing_env_file_is_a_distinct_status(self, tmp_path, monkeypatch):
        example = tmp_path / ".env.example"
        example.write_text("A=1\n")
        monkeypatch.setattr(
            sys, "argv",
            ["env_diff.py", "--env", str(tmp_path / "nope"), "--example", str(example), "--quiet"],
        )
        # 2, not 1: "you have no .env" is a different problem from "your .env
        # is missing a key", and `make update` should not conflate them.
        assert env_diff.main() == 2
