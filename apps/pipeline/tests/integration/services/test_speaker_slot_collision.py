"""#972: inference lost every speaker name on 39 episodes (~4% of the library).

Root cause: ``write_speaker_names`` numbers guest slots SPEAKER_01, SPEAKER_02,
… by classifier list order, ignoring the ``label_map`` it is handed. Meanwhile
``assign_speaker_slots`` allocates Other slots starting immediately after the
real labels. When the classifier produces at least as many guests as there are
real labels, a guest slot number collides with an Other slot number, and both
``write_speaker_names`` and ``_write_other_rows`` add a pending row for the
same ``(episode_id, speaker_label)``.

The production session is ``autoflush=False`` (app/database.py), so neither
existence check sees the other's pending row. Both land in one flush at
``db.commit()`` and Postgres rejects the batch on uq_speaker_episode_label.
Inference is a soft failure, so the rollback silently discards *all* names for
the episode — including the ones computed correctly.

These tests require an ``autoflush=False`` session. The shared ``db_session``
fixture used to take SQLAlchemy's default of True, which flushes on the
existence query and hid this class of bug entirely; it now mirrors production.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Segment, SpeakerName
from app.services.inference import SlotAssignment
from app.services.inference_db import write_speaker_names
from app.services.inference_types import CandidateName, InferenceResult
from app.tasks.infer import _write_other_rows


@pytest.fixture
def no_autoflush_session(db_session):
    """These tests are only meaningful on a production-shaped session.

    Asserted rather than set: if the shared fixture ever drifts back to
    autoflush=True, these tests would silently start passing for the wrong
    reason -- the existence check would flush the pending row and find it,
    so the collision could not reproduce.
    """
    assert db_session.autoflush is False, (
        "db_session must mirror app/database.py (autoflush=False); "
        "with autoflush on, #972 cannot reproduce"
    )
    return db_session


def _add_segments(db, episode_id: str, labels: list[str]) -> None:
    for i, label in enumerate(labels):
        db.add(
            Segment(
                # id is BigInteger autoincrement -- let the DB assign it.
                episode_id=episode_id,
                start_time=float(i),
                end_time=float(i) + 1.0,
                text=f"segment {i}",
                speaker_label=label,
            )
        )
    db.flush()


def _result_with_guests(*names: str) -> InferenceResult:
    return InferenceResult(
        host=CandidateName(name="Host Person", source="feed_title", role="host",
                           confidence="HIGH"),
        guests=[
            CandidateName(name=n, source="episode_description", role="guest",
                          confidence="HIGH")
            for n in names
        ],
    )


class TestGuestSlotCollidesWithOtherSlot:
    """Two real labels, two guests -> guest #2 claims SPEAKER_02, which the
    run analysis already allocated as an Other slot."""

    def test_commit_succeeds_when_a_guest_number_hits_an_other_slot(
        self, no_autoflush_session, sample_episode
    ):
        db = no_autoflush_session
        # Segments carry SPEAKER_00 and SPEAKER_02 -- the shape seen on the
        # reported episode, where the pre-remap labels are non-contiguous.
        _add_segments(db, sample_episode.id, ["SPEAKER_00"] * 3 + ["SPEAKER_02"] * 3)

        # Real labels occupy SPEAKER_00/01; Other slots start at SPEAKER_02.
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_02"},
            label_remap={"SPEAKER_00": "SPEAKER_00", "SPEAKER_02": "SPEAKER_01"},
        )
        result = _result_with_guests("Guest One", "Guest Two")

        write_speaker_names(sample_episode.id, assignment.label_remap, result, db)
        _write_other_rows(sample_episode.id, assignment, db)

        db.commit()  # pre-fix: IntegrityError on uq_speaker_episode_label

        rows = (
            db.query(SpeakerName)
            .filter(SpeakerName.episode_id == sample_episode.id)
            .all()
        )
        labels = [r.speaker_label for r in rows]
        assert len(labels) == len(set(labels)), f"duplicate slots written: {labels}"

    def test_the_host_name_survives_the_collision(
        self, no_autoflush_session, sample_episode
    ):
        # The regression that actually cost data: the rollback discarded every
        # name, including ones computed correctly on uncontested slots.
        db = no_autoflush_session
        _add_segments(db, sample_episode.id, ["SPEAKER_00"] * 3 + ["SPEAKER_02"] * 3)
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_02"},
            label_remap={"SPEAKER_00": "SPEAKER_00", "SPEAKER_02": "SPEAKER_01"},
        )

        write_speaker_names(
            sample_episode.id, assignment.label_remap,
            _result_with_guests("Guest One", "Guest Two"), db,
        )
        _write_other_rows(sample_episode.id, assignment, db)
        db.commit()

        host = (
            db.query(SpeakerName)
            .filter(
                SpeakerName.episode_id == sample_episode.id,
                SpeakerName.speaker_label == "SPEAKER_00",
            )
            .one()
        )
        assert host.display_name == "Host Person"

    def test_a_contested_slot_is_not_silently_renamed_to_an_empty_other(
        self, no_autoflush_session, sample_episode
    ):
        # Guards the tempting wrong fix. Simply letting the second writer win
        # (or turning autoflush on) makes _write_other_rows overwrite the
        # guest name with display_name="" -- a crash traded for silent
        # corruption. A slot the run analysis allocated as Other must not end
        # up holding a guest name either; it should just be Other.
        db = no_autoflush_session
        _add_segments(db, sample_episode.id, ["SPEAKER_00"] * 3 + ["SPEAKER_02"] * 3)
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_02"},
            label_remap={"SPEAKER_00": "SPEAKER_00", "SPEAKER_02": "SPEAKER_01"},
        )

        write_speaker_names(
            sample_episode.id, assignment.label_remap,
            _result_with_guests("Guest One", "Guest Two"), db,
        )
        _write_other_rows(sample_episode.id, assignment, db)
        db.commit()

        row = (
            db.query(SpeakerName)
            .filter(
                SpeakerName.episode_id == sample_episode.id,
                SpeakerName.speaker_label == "SPEAKER_02",
            )
            .one_or_none()
        )
        assert row is not None
        assert row.role == "other"
        assert row.display_name == ""

    def test_no_collision_when_guests_fit_the_real_slots(
        self, no_autoflush_session, sample_episode
    ):
        # The already-working case, pinned so the fix does not change it:
        # three real labels, two guests -> SPEAKER_01/02 are both real.
        db = no_autoflush_session
        _add_segments(
            db, sample_episode.id,
            ["SPEAKER_00"] * 2 + ["SPEAKER_01"] * 2 + ["SPEAKER_02"] * 2,
        )
        assignment = SlotAssignment(
            new_labels=[],
            other_labels={"SPEAKER_03"},
            label_remap={
                "SPEAKER_00": "SPEAKER_00",
                "SPEAKER_01": "SPEAKER_01",
                "SPEAKER_02": "SPEAKER_02",
            },
        )

        write_speaker_names(
            sample_episode.id, assignment.label_remap,
            _result_with_guests("Guest One", "Guest Two"), db,
        )
        _write_other_rows(sample_episode.id, assignment, db)
        db.commit()

        by_label = {
            r.speaker_label: r
            for r in db.query(SpeakerName)
            .filter(SpeakerName.episode_id == sample_episode.id)
            .all()
        }
        assert by_label["SPEAKER_01"].display_name == "Guest One"
        assert by_label["SPEAKER_02"].display_name == "Guest Two"
