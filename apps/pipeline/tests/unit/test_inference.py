"""
Unit tests for host/guest inference — PRD-04 §11

All tests mock spaCy NER output to avoid requiring a live model.
"""
from unittest.mock import MagicMock, patch

import pytest

from app.services.inference import (
    CandidateName,
    InferenceResult,
    assign_speaker_slots,
    classify_candidates,
    extract_candidates,
    strip_html,
    write_speaker_names,
)


# --- Helpers ---

def _make_spacy_ent(text: str, label: str) -> MagicMock:
    ent = MagicMock()
    ent.text = text
    ent.label_ = label
    return ent


def _make_nlp(entities: list[tuple[str, str]]):
    """Return a mock spaCy nlp callable that returns given entities for any input."""
    nlp = MagicMock()

    def process(text):
        doc = MagicMock()
        doc.ents = [_make_spacy_ent(name, label) for name, label in entities]
        return doc

    nlp.side_effect = process
    return nlp


# --- strip_html ---

class TestStripHtml:
    def test_removes_tags(self):
        assert strip_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_preserves_plain_text(self):
        assert strip_html("No tags here") == "No tags here"

    def test_handles_empty_string(self):
        assert strip_html("") == ""


# --- extract_candidates ---

class TestExtractCandidates:
    def test_extracts_person_entities(self):
        nlp = _make_nlp([("Jane Smith", "PERSON"), ("Stanford", "ORG")])
        result = extract_candidates(nlp, "My guest is Jane Smith from Stanford", None, None)
        assert len(result) == 1
        assert result[0].name == "Jane Smith"
        assert result[0].source == "episode_description"

    def test_deduplicates_by_normalized_name(self):
        nlp = _make_nlp([("Jane Smith", "PERSON")])
        result = extract_candidates(
            nlp, "Jane Smith is here", None, "Hosted by Jane Smith"
        )
        # Same name from two sources — should be deduplicated
        assert len(result) == 1

    def test_extracts_from_all_sources(self):
        # Each source returns a different person
        call_count = 0
        def nlp_side_effect(text):
            nonlocal call_count
            doc = MagicMock()
            names = [
                [("Alice", "PERSON")],   # episode_description
                [("Bob", "PERSON")],     # feed_title
                [("Charlie", "PERSON")], # feed_description
            ]
            doc.ents = [_make_spacy_ent(n, l) for n, l in names[call_count]]
            call_count += 1
            return doc

        nlp = MagicMock(side_effect=nlp_side_effect)
        result = extract_candidates(nlp, "ep desc", "feed title", "feed desc")
        assert len(result) == 3
        assert result[0].source == "episode_description"
        assert result[1].source == "feed_title"
        assert result[2].source == "feed_description"

    def test_skips_none_sources(self):
        nlp = _make_nlp([("Jane", "PERSON")])
        result = extract_candidates(nlp, None, None, None)
        assert len(result) == 0
        nlp.assert_not_called()

    def test_strips_html_before_ner(self):
        nlp = _make_nlp([("Jane Smith", "PERSON")])
        result = extract_candidates(nlp, "<p>Guest: <b>Jane Smith</b></p>", None, None)
        assert len(result) == 1
        # Verify nlp was called with stripped text
        nlp.assert_called_with("Guest: Jane Smith")


# --- classify_candidates ---

class TestClassifyCandidates:
    def test_host_from_feed_title(self):
        """PRD-04 §4.2: name in feed title → host HIGH"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Jane Smith", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "my guest today is Dr. Jane Smith", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        assert result.host.confidence == "HIGH"

    def test_guest_from_proximity(self):
        """PRD-04 §4.2: name near guest signal → guest"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Jane Smith", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "my guest today is Dr. Jane Smith", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        jane = [g for g in result.guests if g.name == "Jane Smith"]
        assert len(jane) == 1
        assert jane[0].confidence == "HIGH"

    def test_host_from_feed_description(self):
        """PRD-04 §4.2: name near 'hosted by' in feed desc → host MEDIUM"""
        candidates = [
            CandidateName(name="Joe Rogan", source="feed_description"),
            CandidateName(name="Bob Lazar", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "We discuss aliens with Bob Lazar.", None, "Hosted by Joe Rogan"
        )
        assert result.host is not None
        assert result.host.name == "Joe Rogan"
        assert result.host.confidence == "MEDIUM"

    def test_guest_from_episode_title_colon(self):
        """PRD-04 §4.2: name after colon → guest HIGH"""
        candidates = [CandidateName(name="Elon Musk", source="episode_description")]
        result = classify_candidates(
            candidates, "Ep 42: Elon Musk on AI\nWe discuss the future.", None, None
        )
        assert len(result.guests) == 1
        assert result.guests[0].name == "Elon Musk"
        assert result.guests[0].confidence == "HIGH"

    def test_multi_guest(self):
        """PRD-04 §4.2: multiple guests extracted"""
        candidates = [
            CandidateName(name="Alice Chen", source="episode_description"),
            CandidateName(name="Bob Kim", source="episode_description"),
        ]
        result = classify_candidates(
            candidates,
            "This week featuring Alice Chen and Bob Kim from Google.",
            None,
            None,
        )
        assert result.host is None
        assert len(result.guests) == 2

    def test_no_names(self):
        """PRD-04 §4.2: no candidates → empty result"""
        result = classify_candidates([], "Today we discuss the economy", None, None)
        assert result.host is None
        assert result.guests == []

    def test_single_name_is_guest_low(self):
        """PRD-04 §4.2: single name that matches host signal → reclassified as guest LOW"""
        candidates = [CandidateName(name="Tim Ferriss", source="feed_title")]
        result = classify_candidates(
            candidates, "No guests this week", "The Tim Ferriss Show", None
        )
        # Single name found, so should be reclassified as guest LOW
        assert result.host is None
        assert len(result.guests) == 1
        assert result.guests[0].confidence == "LOW"

    def test_fallback_low_confidence(self):
        """PRD-04 §4.2: name with no signals → guest LOW"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Unknown Person", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "We discuss things with Unknown Person", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        # Unknown Person has no guest signals → LOW
        unknown = [g for g in result.guests if g.name == "Unknown Person"]
        assert len(unknown) == 1
        assert unknown[0].confidence == "LOW"


# --- assign_speaker_slots ---

class TestAssignSpeakerSlots:
    def test_most_speaking_time_gets_speaker_00(self):
        """PRD-04 §4.5: highest speaking time → SPEAKER_00"""
        segments = [
            {"speaker_label": "SPEAKER_01", "start_time": 0, "end_time": 60},   # 60s
            {"speaker_label": "SPEAKER_00", "start_time": 60, "end_time": 100},  # 40s
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map["SPEAKER_01"] == "SPEAKER_00"  # most speaking time
        assert label_map["SPEAKER_00"] == "SPEAKER_01"

    def test_guest_order_by_first_appearance(self):
        """PRD-04 §4.4: guests ordered by first appearance"""
        segments = [
            {"speaker_label": "SPEAKER_02", "start_time": 0, "end_time": 10},
            {"speaker_label": "SPEAKER_00", "start_time": 10, "end_time": 100},  # most time
            {"speaker_label": "SPEAKER_01", "start_time": 100, "end_time": 110},
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map["SPEAKER_00"] == "SPEAKER_00"  # most time → SPEAKER_00
        assert label_map["SPEAKER_02"] == "SPEAKER_01"  # appeared first among guests
        assert label_map["SPEAKER_01"] == "SPEAKER_02"  # appeared second

    def test_empty_segments(self):
        result = InferenceResult()
        assert assign_speaker_slots(result, []) == {}

    def test_no_speaker_labels(self):
        segments = [
            {"speaker_label": None, "start_time": 0, "end_time": 10},
        ]
        result = InferenceResult()
        assert assign_speaker_slots(result, segments) == {}

    def test_single_speaker(self):
        segments = [
            {"speaker_label": "SPEAKER_00", "start_time": 0, "end_time": 100},
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map == {"SPEAKER_00": "SPEAKER_00"}


# --- write_speaker_names ---

class TestWriteSpeakerNames:
    def test_writes_inferred_host_and_guest(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        guest = CandidateName(name="Jane Smith", source="episode_description", role="guest", confidence="MEDIUM")
        result = InferenceResult(host=host, guests=[guest])
        label_map = {"SPEAKER_01": "SPEAKER_00", "SPEAKER_00": "SPEAKER_01"}

        write_speaker_names("ep-1", label_map, result, db)

        # Should have added 2 SpeakerName objects
        assert db.add.call_count == 2

    def test_does_not_overwrite_user_confirmed(self):
        """PRD-04 §5.1: don't overwrite confirmed_by_user = true"""
        existing = MagicMock()
        existing.confirmed_by_user = True

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = existing

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        result = InferenceResult(host=host, guests=[])
        label_map = {"SPEAKER_00": "SPEAKER_00"}

        write_speaker_names("ep-1", label_map, result, db)

        # Should NOT have been modified
        assert db.add.call_count == 0
        assert existing.display_name != "Tim Ferriss"  # unchanged (still mock default)


# --- Soft failure in task ---

class TestInferSpeakersTask:
    def test_soft_failure_sets_inference_error(self):
        """PRD-04 §4.6: inference failure is non-blocking"""
        db = MagicMock()

        episode = MagicMock()
        episode.id = "ep-1"
        episode.has_diarization = True
        episode.feed_id = "feed-1"
        episode.description = "some text"
        db.query.return_value.filter.return_value.first.return_value = episode

        with (
            patch("app.tasks.infer.SessionLocal", return_value=db),
            patch("app.services.inference.load_spacy_model", side_effect=RuntimeError("No model")),
            patch("app.tasks.infer.archive_episode") as mock_archive,
        ):
            mock_archive.delay = MagicMock()
            from app.tasks.infer import infer_speakers
            # Call .run() to bypass Celery result backend
            infer_speakers.run("ep-1")

        # Verify inference_error was set
        update_calls = db.query.return_value.filter.return_value.update.call_args_list
        error_updates = [c for c in update_calls if "inference_error" in (c[0][0] if c[0] else {})]
        assert len(error_updates) > 0

    def test_skipped_when_no_diarization(self):
        """PRD-04 §4.6: skip inference if has_diarization=false"""
        db = MagicMock()

        episode = MagicMock()
        episode.id = "ep-1"
        episode.has_diarization = False
        db.query.return_value.filter.return_value.first.return_value = episode

        with (
            patch("app.tasks.infer.SessionLocal", return_value=db),
            patch("app.tasks.infer.archive_episode") as mock_archive,
        ):
            mock_archive.delay = MagicMock()
            from app.tasks.infer import infer_speakers
            infer_speakers.run("ep-1")

        # Should have set inference_skipped
        update_calls = db.query.return_value.filter.return_value.update.call_args_list
        skip_updates = [c for c in update_calls if "inference_skipped" in (c[0][0] if c[0] else {})]
        assert len(skip_updates) > 0
