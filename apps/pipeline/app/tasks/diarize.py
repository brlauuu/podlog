"""
Diarization task — PRD-01 §5.5

- Runs pyannote speaker diarization on the audio file
- Aligns speaker segments with Whisper transcript segments (majority overlap)
- Updates segment speaker_label in database
- Graceful failure: if diarization fails for any reason, episode is still marked
  done (has_diarization=False, diarization_error populated)
"""
import logging
from pathlib import Path

from celery import shared_task

from app.database import SessionLocal
from app.models import Episode, Segment

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="diarize_episode")
def diarize_episode(self, episode_id: str) -> str:
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode or not episode.audio_local_path:
            raise RuntimeError(f"Episode {episode_id} missing for diarization")

        audio_path = episode.audio_local_path

        try:
            from app.services.pyannote import diarize
            from app.services.alignment import assign_speakers

            diarization_segments = diarize(audio_path)
            transcript_segments = (
                db.query(Segment)
                .filter(Segment.episode_id == episode_id)
                .order_by(Segment.start_time)
                .all()
            )

            assignments = assign_speakers(
                transcript_segments=[
                    {"id": s.id, "start": s.start_time, "end": s.end_time}
                    for s in transcript_segments
                ],
                diarization_segments=diarization_segments,
            )

            for seg_id, speaker in assignments.items():
                db.query(Segment).filter(Segment.id == seg_id).update(
                    {"speaker_label": speaker}
                )

            db.query(Episode).filter(Episode.id == episode_id).update(
                {"has_diarization": True, "diarization_error": None}
            )
            db.commit()

            logger.info(
                '"action": "diarize_complete", "episode_id": "%s", "speakers": %d',
                episode_id,
                len(set(assignments.values())),
            )
        except Exception as exc:
            # Diarization failure is non-fatal — transcript is preserved (PRD-01 §5.5)
            db.query(Episode).filter(Episode.id == episode_id).update(
                {
                    "has_diarization": False,
                    "diarization_error": str(exc),
                    # Note: error_class is NOT set — this is not a job failure
                }
            )
            db.commit()
            logger.warning(
                '"action": "diarize_failed_graceful", "episode_id": "%s", "error": "%s"',
                episode_id,
                str(exc),
            )

        # PRD-04 §4.6: inference runs after diarization, before archival
        from app.tasks.infer import infer_speakers
        infer_speakers.delay(episode_id)
        return episode_id
    finally:
        db.close()
