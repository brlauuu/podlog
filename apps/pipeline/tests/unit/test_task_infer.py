"""Unit tests for app.tasks.infer — speaker inference task."""
from unittest.mock import MagicMock, patch

import pytest

from app.services.inference import SlotAssignment


def _empty_assignment() -> SlotAssignment:
    """A SlotAssignment placeholder for tests that don't care about
    slot-assignment specifics — the run-based logic is exercised by
    test_inference.py::TestAssignSpeakerSlots."""
    return SlotAssignment(new_labels=[], other_labels=set(), label_remap={})


def _assignment_from_label_map(label_map: dict[str, str]) -> SlotAssignment:
    """Build a SlotAssignment for a simple identity-style remap."""
    return SlotAssignment(new_labels=[], other_labels=set(), label_remap=label_map)


def _make_episode(id_="ep1", has_diarization=True, description="With guest Jane Smith",
                  feed_id="feed1", title=None, episode_author=None, podcast_persons=None):
    ep = MagicMock()
    ep.id = id_
    ep.has_diarization = has_diarization
    ep.description = description
    ep.feed_id = feed_id
    ep.title = title
    ep.episode_author = episode_author
    ep.podcast_persons = podcast_persons
    return ep


def _make_feed(id_="feed1", title="The Tim Ferriss Show", description="Interviews",
               itunes_author=None, itunes_owner_name=None, podcast_persons=None):
    feed = MagicMock()
    feed.id = id_
    feed.title = title
    feed.description = description
    feed.itunes_author = itunes_author
    feed.itunes_owner_name = itunes_owner_name
    feed.podcast_persons = podcast_persons
    return feed


def _make_segment(id_=1, speaker="SPEAKER_00", start=0.0, end=5.0):
    seg = MagicMock()
    seg.id = id_
    seg.speaker_label = speaker
    seg.start_time = start
    seg.end_time = end
    return seg


class TestInferSpeakers:
    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_skip_when_inference_disabled(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with patch("app.tasks.infer.settings") as mock_settings:
            mock_settings.inference_enabled = False

            from app.tasks.infer import infer_speakers

            result = infer_speakers("ep1")

        assert result == "ep1"
        mock_update.assert_called_once_with(db, "ep1", inference_skipped=True)
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "archive")

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_skip_when_no_diarization(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode(has_diarization=False)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with patch("app.tasks.infer.settings") as mock_settings:
            mock_settings.inference_enabled = True

            from app.tasks.infer import infer_speakers

            result = infer_speakers("ep1")

        assert result == "ep1"
        mock_update.assert_called_once_with(db, "ep1", inference_skipped=True)
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "archive")

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_happy_path_with_candidates(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        feed = _make_feed()
        segs = [_make_segment(1, "SPEAKER_00"), _make_segment(2, "SPEAKER_01", start=5.0, end=10.0)]
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [ep, feed]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        candidates = [{"name": "Jane Smith", "source": "description"}]
        mock_result = MagicMock()
        label_map = {"SPEAKER_00": "SPEAKER_00", "SPEAKER_01": "SPEAKER_01"}

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", return_value=MagicMock()),
            patch("app.services.inference.unload_spacy_model"),
            patch("app.services.inference.extract_candidates", return_value=candidates),
            patch("app.services.inference.classify_candidates", return_value=mock_result),
            patch("app.services.inference.assign_speaker_slots", return_value=_assignment_from_label_map(label_map)),
            patch("app.services.inference.write_speaker_names"),
            patch("app.services.inference.get_feed_speaker_cache_priors", return_value=[]),
            patch("app.tasks.infer._apply_segment_remap"), patch("app.tasks.infer._write_other_rows"),
        ):
            mock_settings.inference_enabled = True

            from app.tasks.infer import infer_speakers

            result = infer_speakers("ep1")

        assert result == "ep1"
        mock_update.assert_any_call(db, "ep1", status="inferring")
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "archive")

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_no_candidates_still_remaps(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        feed = _make_feed()
        segs = [_make_segment()]
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [ep, feed]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        label_map = {"SPEAKER_00": "SPEAKER_00"}

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", return_value=MagicMock()),
            patch("app.services.inference.unload_spacy_model"),
            patch("app.services.inference.extract_candidates", return_value=[]),
            patch("app.services.inference.assign_speaker_slots", return_value=_assignment_from_label_map(label_map)),
            patch("app.services.inference.get_feed_speaker_cache_priors", return_value=[]),
            patch("app.tasks.infer._apply_segment_remap"), patch("app.tasks.infer._write_other_rows"),
        ):
            mock_settings.inference_enabled = True

            from app.tasks.infer import infer_speakers

            result = infer_speakers("ep1")

        assert result == "ep1"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "archive")

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_recurring_host_is_plumbed_through(self, mock_session_cls, mock_update, mock_jq):
        """PRD-04 A1: the task queries get_recurring_host_name and forwards
        the result into extract_metadata_candidates."""
        ep = _make_episode()
        feed = _make_feed()
        segs = [_make_segment(1, "SPEAKER_00"), _make_segment(2, "SPEAKER_01", start=5.0, end=10.0)]
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [ep, feed]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", return_value=MagicMock()),
            patch("app.services.inference.unload_spacy_model"),
            patch("app.services.inference.extract_candidates", return_value=[]),
            patch(
                "app.services.inference.get_recurring_host_name",
                return_value="Recurring Host",
            ) as mock_recurring,
            patch(
                "app.services.inference.extract_metadata_candidates",
                return_value=[],
            ) as mock_meta,
            patch("app.services.inference.assign_speaker_slots", return_value=_empty_assignment()),
            patch("app.services.inference.get_feed_speaker_cache_priors", return_value=[]),
            patch("app.tasks.infer._apply_segment_remap"), patch("app.tasks.infer._write_other_rows"),
        ):
            mock_settings.inference_enabled = True
            mock_settings.recurring_host_window = 10
            mock_settings.recurring_host_threshold = 0.8

            from app.tasks.infer import infer_speakers

            infer_speakers("ep1")

        mock_recurring.assert_called_once()
        call_kwargs = mock_recurring.call_args.kwargs
        assert call_kwargs["feed_id"] == "feed1"
        assert call_kwargs["current_episode_id"] == "ep1"
        assert call_kwargs["window"] == 10
        assert call_kwargs["threshold"] == 0.8
        assert mock_meta.call_args.kwargs["recurring_host_name"] == "Recurring Host"

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_recurring_host_skipped_when_no_feed_id(self, mock_session_cls, mock_update, mock_jq):
        """If the episode has no feed_id, the recurring-host query is skipped."""
        ep = _make_episode(feed_id=None)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", return_value=MagicMock()),
            patch("app.services.inference.unload_spacy_model"),
            patch("app.services.inference.extract_candidates", return_value=[]),
            patch(
                "app.services.inference.get_recurring_host_name"
            ) as mock_recurring,
            patch(
                "app.services.inference.extract_metadata_candidates",
                return_value=[],
            ) as mock_meta,
            patch("app.services.inference.assign_speaker_slots", return_value=_empty_assignment()),
            patch(
                "app.services.inference.get_feed_speaker_cache_priors",
                return_value=[],
            ) as mock_cache,
            patch("app.tasks.infer._apply_segment_remap"), patch("app.tasks.infer._write_other_rows"),
        ):
            mock_settings.inference_enabled = True
            mock_settings.recurring_host_window = 10
            mock_settings.recurring_host_threshold = 0.8

            from app.tasks.infer import infer_speakers

            infer_speakers("ep1")

        mock_recurring.assert_not_called()
        mock_cache.assert_not_called()
        assert mock_meta.call_args.kwargs["recurring_host_name"] is None
        assert mock_meta.call_args.kwargs["feed_speaker_cache_priors"] == []

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_feed_speaker_cache_is_plumbed_through(
        self, mock_session_cls, mock_update, mock_jq
    ):
        """PRD-04 C1/C2: task queries get_feed_speaker_cache_priors and forwards
        the result into extract_metadata_candidates."""
        ep = _make_episode()
        feed = _make_feed()
        segs = [_make_segment(1, "SPEAKER_00")]
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [ep, feed]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        cache_priors = [
            {"name": "Cached Host", "speaker_label": "SPEAKER_00", "occurrence_count": 5}
        ]

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", return_value=MagicMock()),
            patch("app.services.inference.unload_spacy_model"),
            patch("app.services.inference.extract_candidates", return_value=[]),
            patch(
                "app.services.inference.get_recurring_host_name", return_value=None
            ),
            patch(
                "app.services.inference.get_feed_speaker_cache_priors",
                return_value=cache_priors,
            ) as mock_cache,
            patch(
                "app.services.inference.extract_metadata_candidates",
                return_value=[],
            ) as mock_meta,
            patch("app.services.inference.assign_speaker_slots", return_value=_empty_assignment()),
            patch("app.tasks.infer._apply_segment_remap"), patch("app.tasks.infer._write_other_rows"),
        ):
            mock_settings.inference_enabled = True
            mock_settings.recurring_host_window = 10
            mock_settings.recurring_host_threshold = 0.8

            from app.tasks.infer import infer_speakers

            infer_speakers("ep1")

        mock_cache.assert_called_once()
        cache_call_kwargs = mock_cache.call_args.kwargs
        assert cache_call_kwargs["feed_id"] == "feed1"
        assert mock_meta.call_args.kwargs["feed_speaker_cache_priors"] == cache_priors

    @patch("app.tasks.infer.job_queue")
    @patch("app.tasks.infer.update_episode")
    @patch("app.tasks.infer.SessionLocal")
    def test_inference_failure_is_non_fatal(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        feed = _make_feed()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [ep, feed]
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.infer.settings") as mock_settings,
            patch("app.services.inference.load_spacy_model", side_effect=RuntimeError("spacy crash")),
            patch("app.services.inference.unload_spacy_model"),
        ):
            mock_settings.inference_enabled = True

            from app.tasks.infer import infer_speakers

            result = infer_speakers("ep1")

        assert result == "ep1"
        db.rollback.assert_called()
        mock_update.assert_any_call(db, "ep1", inference_error="spacy crash")
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "archive")


class TestApplySegmentRemap:
    """The remap is now per-segment, not per-label (#703 PR 2) — fully
    short pyannote labels can fragment across multiple new slots."""

    def test_none_assignment_is_noop(self):
        from app.tasks.infer import _apply_segment_remap
        _apply_segment_remap([MagicMock()], None)  # must not raise

    def test_empty_segments_is_noop(self):
        from app.tasks.infer import _apply_segment_remap
        _apply_segment_remap([], _empty_assignment())  # must not raise

    def test_per_segment_remap_overrides_label_when_changed(self):
        from app.tasks.infer import _apply_segment_remap
        seg1 = MagicMock(); seg1.speaker_label = "SPEAKER_X"
        seg2 = MagicMock(); seg2.speaker_label = "SPEAKER_Y"
        assignment = SlotAssignment(
            new_labels=["SPEAKER_00", "SPEAKER_01"],
            other_labels=set(),
            label_remap={"SPEAKER_X": "SPEAKER_00", "SPEAKER_Y": "SPEAKER_01"},
        )

        _apply_segment_remap([seg1, seg2], assignment)

        assert seg1.speaker_label == "SPEAKER_00"
        assert seg2.speaker_label == "SPEAKER_01"

    def test_per_segment_remap_handles_fragmented_label(self):
        """A fully-short pyannote label fragmenting across runs writes
        different new labels to segments with the same source label."""
        from app.tasks.infer import _apply_segment_remap
        seg1 = MagicMock(); seg1.speaker_label = "SPEAKER_X"  # cold open run
        seg2 = MagicMock(); seg2.speaker_label = "SPEAKER_Y"  # host
        seg3 = MagicMock(); seg3.speaker_label = "SPEAKER_X"  # later short run
        assignment = SlotAssignment(
            new_labels=["SPEAKER_01", "SPEAKER_00", "SPEAKER_02"],
            other_labels={"SPEAKER_01", "SPEAKER_02"},
            label_remap={"SPEAKER_Y": "SPEAKER_00"},
        )

        _apply_segment_remap([seg1, seg2, seg3], assignment)

        # Same source label SPEAKER_X became two different new labels
        # (one per run) — pre-#703 logic could not express this.
        assert seg1.speaker_label == "SPEAKER_01"
        assert seg2.speaker_label == "SPEAKER_00"
        assert seg3.speaker_label == "SPEAKER_02"

    def test_none_in_new_labels_leaves_segment_unchanged(self):
        from app.tasks.infer import _apply_segment_remap
        seg = MagicMock(); seg.speaker_label = "SPEAKER_X"
        assignment = SlotAssignment(
            new_labels=[None],
            other_labels=set(),
            label_remap={},
        )

        _apply_segment_remap([seg], assignment)

        assert seg.speaker_label == "SPEAKER_X"  # unchanged


class TestWriteOtherRows:
    def test_writes_one_row_per_other_label(self):
        from app.tasks.infer import _write_other_rows
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_02", "SPEAKER_03"},
            label_remap={},
        )

        _write_other_rows("ep-1", assignment, db)

        assert db.add.call_count == 2

    def test_skips_user_confirmed_rows(self):
        from app.tasks.infer import _write_other_rows
        existing = MagicMock()
        existing.confirmed_by_user = True
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = existing
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_02"},
            label_remap={},
        )

        _write_other_rows("ep-1", assignment, db)

        assert db.add.call_count == 0
        # Confirmed row not touched.
        assert existing.role != "other"

    def test_no_other_labels_is_noop(self):
        from app.tasks.infer import _write_other_rows
        db = MagicMock()

        _write_other_rows("ep-1", _empty_assignment(), db)

        db.add.assert_not_called()
