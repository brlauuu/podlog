"""
Speaker inference task — PRD-04 §4.6

Runs after diarization, before archival. Extracts host/guest names from
episode metadata using spaCy NER, remaps speaker labels, and pre-populates
the speaker_names table.

Soft failure: if inference fails, episode continues to archival with
inference_error populated. No retry.
"""
import logging
from datetime import datetime, timezone

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Feed, Segment
from app.tasks.archive import archive_episode

logger = logging.getLogger(__name__)


from app.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="infer_speakers")
def infer_speakers(self, episode_id: str) -> str:
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        # Skip if inference is disabled
        if not settings.inference_enabled:
            db.query(Episode).filter(Episode.id == episode_id).update(
                {"inference_skipped": True, "updated_at": datetime.now(timezone.utc)}
            )
            db.commit()
            archive_episode.delay(episode_id)
            return episode_id

        # Skip if no diarization (PRD-04 §4.6)
        if not episode.has_diarization:
            db.query(Episode).filter(Episode.id == episode_id).update(
                {"inference_skipped": True, "updated_at": datetime.now(timezone.utc)}
            )
            db.commit()
            archive_episode.delay(episode_id)
            return episode_id

        db.query(Episode).filter(Episode.id == episode_id).update(
            {"status": "inferring", "updated_at": datetime.now(timezone.utc)}
        )
        db.commit()

        try:
            from app.services.inference import (
                assign_speaker_slots,
                classify_candidates,
                extract_candidates,
                load_spacy_model,
                unload_spacy_model,
                write_speaker_names,
            )

            # Load feed metadata for host detection
            feed = db.query(Feed).filter(Feed.id == episode.feed_id).first() if episode.feed_id else None
            feed_title = feed.title if feed else None
            feed_description = feed.description if feed else None

            # Step 1: NER extraction
            nlp = load_spacy_model()
            try:
                candidates = extract_candidates(
                    nlp, episode.description, feed_title, feed_description
                )
            finally:
                unload_spacy_model()

            if not candidates:
                # No names found — still remap speaker slots by first appearance
                segments = (
                    db.query(Segment)
                    .filter(Segment.episode_id == episode_id)
                    .order_by(Segment.start_time)
                    .all()
                )
                seg_dicts = [
                    {"speaker_label": s.speaker_label, "start_time": s.start_time, "end_time": s.end_time}
                    for s in segments
                ]
                label_map = assign_speaker_slots(
                    result=None, segments=seg_dicts
                ) if seg_dicts else {}
                _apply_label_remap(db, episode_id, label_map)
                db.commit()
            else:
                # Step 2: classify
                result = classify_candidates(
                    candidates, episode.description, feed_title, feed_description
                )

                # Step 3: remap speaker labels by first appearance
                segments = (
                    db.query(Segment)
                    .filter(Segment.episode_id == episode_id)
                    .order_by(Segment.start_time)
                    .all()
                )
                seg_dicts = [
                    {"speaker_label": s.speaker_label, "start_time": s.start_time, "end_time": s.end_time}
                    for s in segments
                ]
                label_map = assign_speaker_slots(result, seg_dicts)
                _apply_label_remap(db, episode_id, label_map)

                # Step 4: write inferred names
                write_speaker_names(episode_id, label_map, result, db)
                db.commit()

            logger.info(
                '"action": "inference_complete", "episode_id": "%s", "candidates": %d',
                episode_id,
                len(candidates),
            )

        except Exception as exc:
            # Soft failure — non-blocking (PRD-04 §4.6)
            db.rollback()
            db.query(Episode).filter(Episode.id == episode_id).update(
                {"inference_error": str(exc), "updated_at": datetime.now(timezone.utc)}
            )
            db.commit()
            logger.warning(
                '"action": "inference_failed_graceful", "episode_id": "%s", "error": "%s"',
                episode_id,
                str(exc),
            )

        archive_episode.delay(episode_id)
        return episode_id
    finally:
        db.close()


def _apply_label_remap(db, episode_id: str, label_map: dict[str, str]) -> None:
    """Apply speaker label remapping to segments in the database."""
    if not label_map:
        return

    # Check if remapping is actually needed (i.e., labels would change)
    identity = all(k == v for k, v in label_map.items())
    if identity:
        return

    # Use temporary labels to avoid unique constraint violations during swap
    segments = (
        db.query(Segment)
        .filter(Segment.episode_id == episode_id)
        .all()
    )
    for seg in segments:
        if seg.speaker_label and seg.speaker_label in label_map:
            seg.speaker_label = label_map[seg.speaker_label]
