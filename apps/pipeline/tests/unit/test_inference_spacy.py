"""Unit tests for the spaCy model loader / unloader in
app.services.inference (#675). The integration suite exercises the
real model; here we patch out spaCy and just verify the fallback /
unload control flow.
"""
import sys
from unittest.mock import MagicMock, patch

import pytest

from app.services import inference as svc


class TestLoadSpacyModel:
    def test_returns_pipeline_when_primary_model_loads(self, monkeypatch):
        monkeypatch.setattr(svc, "logger", MagicMock())

        fake_spacy = MagicMock()
        nlp = MagicMock(name="trf-pipeline")
        fake_spacy.load.return_value = nlp

        with patch.dict(sys.modules, {"spacy": fake_spacy}):
            from app.config import settings
            monkeypatch.setattr(settings, "spacy_model", "en_core_web_trf", raising=False)

            result = svc.load_spacy_model()

        assert result is nlp
        fake_spacy.load.assert_called_once_with("en_core_web_trf")

    def test_falls_back_to_lg_when_primary_missing(self, monkeypatch):
        monkeypatch.setattr(svc, "logger", MagicMock())

        fake_spacy = MagicMock()
        lg_nlp = MagicMock(name="lg-pipeline")

        def fake_load(name: str):
            if name == "en_core_web_trf":
                raise OSError("not installed")
            return lg_nlp

        fake_spacy.load.side_effect = fake_load
        with patch.dict(sys.modules, {"spacy": fake_spacy}):
            from app.config import settings
            monkeypatch.setattr(settings, "spacy_model", "en_core_web_trf", raising=False)

            result = svc.load_spacy_model()

        assert result is lg_nlp
        assert fake_spacy.load.call_count == 2

    def test_raises_runtime_error_when_no_model_available(self, monkeypatch):
        monkeypatch.setattr(svc, "logger", MagicMock())

        fake_spacy = MagicMock()
        fake_spacy.load.side_effect = OSError("nope")
        with patch.dict(sys.modules, {"spacy": fake_spacy}):
            from app.config import settings
            monkeypatch.setattr(settings, "spacy_model", "en_core_web_trf", raising=False)

            with pytest.raises(RuntimeError, match="No spaCy model available"):
                svc.load_spacy_model()


class TestUnloadSpacyModel:
    def test_clears_cached_nlp_and_runs_gc(self, monkeypatch):
        monkeypatch.setattr(svc, "logger", MagicMock())

        # Simulate a cached pipeline attribute the way load_spacy_model would
        # set it in production (the module currently doesn't, but unload reads
        # via getattr, so we mirror the production contract here).
        mod = sys.modules["app.services.inference"]
        mod._nlp = MagicMock()

        gc_mock = MagicMock()
        monkeypatch.setattr(svc, "gc", gc_mock)

        svc.unload_spacy_model()

        assert mod._nlp is None
        gc_mock.collect.assert_called_once()

    def test_no_op_when_module_has_no_cached_pipeline(self, monkeypatch):
        monkeypatch.setattr(svc, "logger", MagicMock())

        mod = sys.modules["app.services.inference"]
        if hasattr(mod, "_nlp"):
            delattr(mod, "_nlp")

        gc_mock = MagicMock()
        monkeypatch.setattr(svc, "gc", gc_mock)

        svc.unload_spacy_model()

        gc_mock.collect.assert_called_once()
