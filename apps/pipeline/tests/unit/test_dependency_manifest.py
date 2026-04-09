"""Dependency manifest guards for direct imports used by pipeline code."""

from __future__ import annotations

from pathlib import Path
import tomllib


def test_numpy_declared_as_direct_dependency() -> None:
    pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

    poetry = data["tool"]["poetry"]
    main_deps = poetry.get("dependencies", {})
    ml_deps = poetry.get("group", {}).get("ml", {}).get("dependencies", {})

    assert "numpy" in main_deps or "numpy" in ml_deps

