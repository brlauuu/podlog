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

            # PRD-04 B1/B2/B3: pre-classified candidates from RSS person tags.
            # These bypass NER entirely and seed the candidate list with
            # HIGH/MEDIUM host signals before heuristic rules run.
            metadata_candidates = extract_metadata_candidates(
                itunes_author=itunes_author,
                itunes_owner_name=itunes_owner_name,
                episode_author=episode.episode_author,
                feed_podcast_persons=feed_podcast_persons,
                episode_podcast_persons=episode.podcast_persons,
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

            candidates = merge_candidates(metadata_candidates, ner_candidates)

            if not candidates:
                # No names found -- still remap speaker slots by first appearance
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
                    candidates,
                    episode.description,
                    feed_title,
                    feed_description,
                    episode_title=episode.title,
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
            # Soft failure -- non-blocking (PRD-04 S4.6)
            db.rollback()
            update_episode(db, episode_id, inference_error=str(exc))
            logger.warning(
                '"action": "inference_failed_graceful", "episode_id": "%s", "error": "%s"',
                episode_id,
                str(exc),
            )

        job_queue.enqueue(db, episode_id, "archive")
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
