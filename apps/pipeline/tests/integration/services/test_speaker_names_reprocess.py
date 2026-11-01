"""#1133: re-processing left an episode's old speaker_names rows behind.

4a3387d6 went from nine speaker labels to four on re-processing, and kept
rows for all nine: inference only adds or updates rows, so five labels no
segment used any more stayed in speaker search and Ask. A confirmed name
also stayed on its label number, whoever that now was.

`reset_speaker_names_for_new_segments` runs wherever segments are rebuilt:
inferred rows go, confirmed rows stay but are flagged for review.
"""
import uuid

from app.models import Episode, Segment, SpeakerName
from app.services.inference_db import (
    reset_speaker_names_for_new_segments,
    write_speaker_names,
)
from app.services.inference_types import CandidateName, InferenceResult


def _name(db, episode_id, label, name, *, confirmed=False, role=None):
    db.add(
        SpeakerName(
            episode_id=episode_id,
            speaker_label=label,
            display_name=name,
            inferred=not confirmed,
            confidence=None if confirmed else "HIGH",
            confirmed_by_user=confirmed,
            role=role,
        )
    )


def _rows(db, episode_id):
    return {
        r.speaker_label: (r.display_name, r.confirmed_by_user, r.needs_review)
        for r in db.query(SpeakerName).filter(SpeakerName.episode_id == episode_id)
    }


def test_reset_drops_inferred_and_flags_confirmed(db_session, sample_episode, sample_feed):
    ep = sample_episode.id
    other = Episode(
        id=str(uuid.uuid4()), feed_id=sample_feed.id, guid="other", title="Other",
        audio_url="https://example.com/b.mp3", status="done",
    )
    db_session.add(other)
    db_session.flush()
    _name(db_session, ep, "SPEAKER_00", "Galeb", confirmed=True, role="host")
    _name(db_session, ep, "SPEAKER_01", "Agelast Production")
    _name(db_session, ep, "SPEAKER_05", "knjige")  # a pre-#703 phantom
    _name(db_session, other.id, "SPEAKER_01", "Someone else")
    db_session.flush()

    reset_speaker_names_for_new_segments(db_session, ep)

    assert _rows(db_session, ep) == {"SPEAKER_00": ("Galeb", True, True)}
    # Another episode's names are not touched.
    assert _rows(db_session, other.id) == {"SPEAKER_01": ("Someone else", False, False)}


def test_reset_is_idempotent(db_session, sample_episode):
    # Transcribe and diarize both call it in one re-process.
    ep = sample_episode.id
    _name(db_session, ep, "SPEAKER_00", "Galeb", confirmed=True)
    db_session.flush()

    reset_speaker_names_for_new_segments(db_session, ep)
    reset_speaker_names_for_new_segments(db_session, ep)

    assert _rows(db_session, ep) == {"SPEAKER_00": ("Galeb", True, True)}


def test_reprocess_with_fewer_labels_leaves_no_orphaned_inferred_rows(db_session, sample_episode):
    """The issue's regression: re-run inference on fewer labels than before."""
    ep = sample_episode.id
    for label in ["SPEAKER_00", "SPEAKER_01", *[f"SPEAKER_0{i}" for i in range(2, 9)]]:
        _name(db_session, ep, label, f"old {label}")
    _name(db_session, ep, "SPEAKER_09", "Galeb", confirmed=True)
    db_session.flush()

    # Re-process: segments are rebuilt with two speakers.
    reset_speaker_names_for_new_segments(db_session, ep)
    for i, label in enumerate(["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]):
        db_session.add(Segment(episode_id=ep, start_time=float(i), end_time=i + 1.0,
                               text="x", speaker_label=label))
    db_session.flush()
    write_speaker_names(
        ep,
        {"SPEAKER_00": "SPEAKER_00", "SPEAKER_01": "SPEAKER_01"},
        InferenceResult(
            host=CandidateName(name="Galeb Nikačević", confidence="HIGH", source="description"),
            guests=[CandidateName(name="Stellan Skarsgård", confidence="HIGH", source="description")],
        ),
        db_session,
    )
    db_session.flush()

    labels_in_segments = {"SPEAKER_00", "SPEAKER_01"}
    rows = _rows(db_session, ep)
    orphans = {lbl for lbl, (_, confirmed, _) in rows.items()
               if lbl not in labels_in_segments and not confirmed}
    assert orphans == set()
    assert rows["SPEAKER_00"][0] == "Galeb Nikačević"
    assert rows["SPEAKER_01"][0] == "Stellan Skarsgård"
    # The confirmed name survives, flagged, even though its label is gone.
    assert rows["SPEAKER_09"] == ("Galeb", True, True)
