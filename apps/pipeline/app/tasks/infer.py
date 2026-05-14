"""
Speaker inference task -- PRD-04 S4.6

Runs after diarization, before archival. Extracts host/guest names from
episode metadata using spaCy NER, remaps speaker labels, and pre-populates
the speaker_names table.

Soft failure: if inference fails, episode continues to archival with
inference_error populated. No retry.
"""
import logging

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Feed, Segment
from app.services.meta_analysis import set_stale
from app.tasks.helpers import update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def infer_speakers(episode_id: str) -> str:
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        # Skip if inference is disabled
        if not settings.inference_enabled:
            update_episode(db, episode_id, inference_skipped=True)
            job_queue.enqueue(db, episode_id, "archive")
            return episode_id

        # Skip if no diarization (PRD-04 S4.6)
        if not episode.has_diarization:
            update_episode(db, episode_id, inference_skipped=True)
            job_queue.enqueue(db, episode_id, "archive")
            return episode_id

        update_episode(db, episode_id, status="inferring")

        try:
            from app.services.inference import (
                assign_speaker_slots,
                classify_candidates,
                extract_candidates,
                extract_metadata_candidates,
                get_feed_speaker_cache_priors,
                get_recurring_host_name,
                load_spacy_model,
                merge_candidates,
                unload_spacy_model,
                write_speaker_names,
            )

            # Load feed metadata for host detection
            feed = db.query(Feed).filter(Feed.id == episode.feed_id).first() if episode.feed_id else None
            feed_title = feed.title if feed else None
            feed_description = feed.description if feed else None
            itunes_author = feed.itunes_author if feed else None
            itunes_owner_name = feed.itunes_owner_name if feed else None
            feed_podcast_persons = feed.podcast_persons if feed else None

            # PRD-04 A1: observed recurring host across this feed's recent
            # episodes. Covers feeds where the host's name never appears in
            # per-episode text (L-01) but is consistently the first speaker.
            recurring_host_name = (
                get_recurring_host_name(
                    db,
                    feed_id=episode.feed_id,
                    current_episode_id=episode_id,
                    window=settings.recurring_host_window,
                    threshold=settings.recurring_host_threshold,
                )
                if episode.feed_id
                else None
            )

            # PRD-04 C1/C2: user-confirmed speaker names from prior episodes
            # of this feed. Ground truth — seeded at HIGH, no self-reinforcement
            # risk (cache is populated only from explicit user renames).
            feed_speaker_cache_priors = (
                get_feed_speaker_cache_priors(db, feed_id=episode.feed_id)
                if episode.feed_id
                else []
            )

            # PRD-04 B1/B2/B3 + A1 + C1/C2: pre-classified candidates from RSS
            # person tags, the recurring-host observation, and the per-feed
            # cache of user confirmations. These bypass NER entirely and seed
            # the candidate list with HIGH/MEDIUM signals before heuristic
            # rules run.
            metadata_candidates = extract_metadata_candidates(
                itunes_author=itunes_author,
                itunes_owner_name=itunes_owner_name,
                episode_author=episode.episode_author,
                feed_podcast_persons=feed_podcast_persons,
                episode_podcast_persons=episode.podcast_persons,
                recurring_host_name=recurring_host_name,
                feed_speaker_cache_priors=feed_speaker_cache_priors,
                # #703 PR 3: SPEAKER_NN cache entries are only seeded
                # when the name is corroborated by this episode's text.
                episode_title=episode.title,
                episode_description=episode.description,
            )

            # Step 1: NER extraction (episode title included per PRD-04 E1/E2)
            nlp = load_spacy_model()
            try:
                ner_candidates = extract_candidates(
                    nlp,
                    episode.description,
                    feed_title,
                    feed_description,
                    episode_title=episode.title,
                )
            finally:
                unload_spacy_model()

            candidates = merge_candidates(
                metadata_candidates, ner_candidates, feed_title=feed_title
            )

            # Common step: load segments and compute the slot assignment.
            # We always run assign_speaker_slots even when no name candidates
            # were found, because it also fragments fully-short pyannote
            # labels into per-run "Other" slots (#703 PR 2).
            segments = (
                db.query(Segment)
                .filter(Segment.episode_id == episode_id)
                .order_by(Segment.start_time)
                .all()
            )
            seg_dicts = [
                {
                    "speaker_label": s.speaker_label,
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                }
                for s in segments
            ]
            assignment = (
                assign_speaker_slots(result=None, segments=seg_dicts)
                if seg_dicts
                else None
            )

            if not candidates:
                # No names found — still apply slot assignment so the
                # segment labels are normalized and any fully-short runs
                # get role='other' rows.
                if assignment is not None:
                    _apply_segment_remap(segments, assignment)
                    _write_other_rows(episode_id, assignment, db)
                db.commit()
            else:
                # Step 2: classify
                result = classify_candidates(
                    candidates,
                    episode.description,
                    feed_title,
                    feed_description,
                    episode_title=episode.title,
                )

                # Step 3: apply slot assignment
                if assignment is not None:
                    _apply_segment_remap(segments, assignment)

                # Step 4: write inferred names (bounded by #703 PR 1) +
                # role='other' rows for fully-short runs (#703 PR 2).
                write_speaker_names(
                    episode_id,
                    assignment.label_remap if assignment else {},
                    result,
                    db,
                )
                if assignment is not None:
                    _write_other_rows(episode_id, assignment, db)
                db.commit()

            logger.info(
                '"action": "inference_complete", "episode_id": "%s", "candidates": %d',
                episode_id,
                len(candidates),
            )

        except Exception as exc:
            # Soft failure -- non-blocking (PRD-04 S4.6)
            db.rollback()
            update_episode(db, episode_id, inference_error=str(exc))
            logger.warning(
                '"action": "inference_failed_graceful", "episode_id": "%s", "error": "%s"',
                episode_id,
                str(exc),
            )

        try:
            set_stale(db)
        except Exception:
            logger.exception(
                '"action": "meta_analysis_stale_set_failed", "episode_id": "%s"',
                episode_id,
            )

        job_queue.enqueue(db, episode_id, "archive")
        return episode_id
    finally:
        db.close()


def _apply_segment_remap(segments, assignment) -> None:
    """Write the per-segment new label from a SlotAssignment back onto
    the SQLAlchemy ORM objects (mutates in place; caller commits).

    Replaces the old _apply_label_remap, which assumed a 1:1
    pyannote_label → new_label dict. The new function handles the
    per-run fragmentation that the run-based short-speaker logic
    introduces (#703 PR 2): segments sharing a pyannote label may end
    up with different new labels if that label was fully-short.
    """
    if assignment is None or not segments:
        return
    for seg, new_label in zip(segments, assignment.new_labels):
        if new_label is None:
            continue
        if seg.speaker_label != new_label:
            seg.speaker_label = new_label


def _write_other_rows(episode_id: str, assignment, db) -> None:
    """Persist a `role='other'` speaker_names row for each SPEAKER_NN
    slot that came from a fragmented fully-short pyannote label (#703
    PR 2). User-confirmed rows are never overwritten.
    """
    if assignment is None or not assignment.other_labels:
        return
    from app.models import SpeakerName

    for new_label in assignment.other_labels:
        existing = (
            db.query(SpeakerName)
            .filter(
                SpeakerName.episode_id == episode_id,
                SpeakerName.speaker_label == new_label,
            )
            .first()
        )
        if existing and existing.confirmed_by_user:
            continue
        if existing:
            existing.display_name = ""
            existing.inferred = True
            existing.confidence = "LOW"
            existing.confirmed_by_user = False
            existing.role = "other"
        else:
            db.add(
                SpeakerName(
                    episode_id=episode_id,
                    speaker_label=new_label,
                    display_name="",
                    inferred=True,
                    confidence="LOW",
                    confirmed_by_user=False,
                    role="other",
                )
            )
