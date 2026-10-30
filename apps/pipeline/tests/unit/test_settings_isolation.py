"""Patching the settings singleton must not leak into model_fields_set (#1100).

Pydantic adds a field to model_fields_set on every assignment, and
patch.object assigns twice without restoring the set. The autouse fixture in
conftest.py restores it after each test. These two run in file order: the
first patches, the second checks nothing leaked.
"""
from unittest.mock import patch

from app.config import settings


def test_patching_a_field_marks_it_set():
    assert "rag_local_model" not in settings.model_fields_set
    with patch.object(settings, "rag_local_model", "other-model"):
        assert "rag_local_model" in settings.model_fields_set


def test_the_patch_did_not_leak_into_the_next_test():
    assert "rag_local_model" not in settings.model_fields_set
