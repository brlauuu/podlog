"""Unit tests for app.tasks.infer — speaker inference task."""
from unittest.mock import MagicMock, patch

import pytest


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
            patch("app.services.inference.assign_speaker_slots", return_value=label_map),
            patch("app.services.inference.write_speaker_names"),
            patch("app.tasks.infer._apply_label_remap"),
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
            patch("app.services.inference.assign_speaker_slots", return_value=label_map),
            patch("app.tasks.infer._apply_label_remap"),
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
            patch("app.services.inference.assign_speaker_slots", return_value={}),
            patch("app.tasks.infer._apply_label_remap"),
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
            patch("app.services.inference.assign_speaker_slots", return_value={}),
            patch("app.tasks.infer._apply_label_remap"),
        ):
            mock_settings.inference_enabled = True
            mock_settings.recurring_host_window = 10
            mock_settings.recurring_host_threshold = 0.8

            from app.tasks.infer import infer_speakers

            infer_speakers("ep1")

        mock_recurring.assert_not_called()
        assert mock_meta.call_args.kwargs["recurring_host_name"] is None

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


class TestApplyLabelRemap:
    def test_identity_map_is_noop(self):
        db = MagicMock()
        from app.tasks.infer import _apply_label_remap

        _apply_label_remap(db, "ep1", {"SPEAKER_00": "SPEAKER_00"})

        db.query.assert_not_called()

    def test_empty_map_is_noop(self):
        db = MagicMock()
        from app.tasks.infer import _apply_label_remap

        _apply_label_remap(db, "ep1", {})

        db.query.assert_not_called()

    def test_remaps_labels(self):
        seg = MagicMock()
        seg.speaker_label = "SPEAKER_01"
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [seg]

        from app.tasks.infer import _apply_label_remap

        _apply_label_remap(db, "ep1", {"SPEAKER_01": "SPEAKER_00"})

        assert seg.speaker_label == "SPEAKER_00"
