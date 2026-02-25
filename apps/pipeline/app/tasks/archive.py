"""
Archive task — PRD-01 §5.7, §5.8

- Compresses audio to MP3 64kbps
- Writes flat .txt transcript file (with or without speaker labels)
- Marks episode done
- Handles disk-full during archival: marks FAILED, preserves raw audio
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from celery import shared_task

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Segment

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="archive_episode")
def archive_episode(self, episode_id: str) -> str:
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        db.query(Episode).filter(Episode.id == episode_id).update({"status": "archiving"})
        db.commit()

        raw_path = Path(episode.audio_local_path) if episode.audio_local_path else None

        # Archive audio (if enabled)
        archived_path = None
        if settings.archive_audio and raw_path and raw_path.exists():
            try:
                archived_path = _compress_audio(raw_path, episode_id)
                raw_path.unlink()  # Delete raw file after successful compression
            except OSError as exc:
                if "No space left on device" in str(exc) or getattr(exc, "errno", None) == 28:
                    db.query(Episode).filter(Episode.id == episode_id).update(
                        {
                            "status": "failed",
                            "error_class": "DISK_FULL",
                            "error_message": "Disk full during archival. Free space and retry.",
                        }
                    )
                    db.commit()
                    logger.error(
                        '"action": "archive_disk_full", "episode_id": "%s"', episode_id
                    )
                    return episode_id  # Raw file is preserved, no retry
                raise
        elif not settings.archive_audio and raw_path and raw_path.exists():
            raw_path.unlink()

        # Write flat .txt transcript
        segments = (
            db.query(Segment)
            .filter(Segment.episode_id == episode_id)
            .order_by(Segment.start_time)
            .all()
        )
        transcript_path = _write_transcript(episode, segments)

        db.query(Episode).filter(Episode.id == episode_id).update(
            {
                "status": "done",
                "audio_local_path": str(archived_path) if archived_path else None,
                "transcript_path": transcript_path,
                "processed_at": datetime.now(timezone.utc),
            }
        )
        db.commit()

        logger.info('"action": "archive_complete", "episode_id": "%s"', episode_id)
        return episode_id
    finally:
        db.close()


def _compress_audio(raw_path: Path, episode_id: str) -> Path:
    import ffmpeg

    archive_dir = Path(settings.audio_archive_dir)
    archive_dir.mkdir(parents=True, exist_ok=True)
    dest = archive_dir / f"{episode_id}.mp3"

    ffmpeg.input(str(raw_path)).output(
        str(dest),
        audio_bitrate=settings.audio_archive_bitrate,
        acodec="libmp3lame",
    ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

    return dest


def _write_transcript(episode: Episode, segments: list[Segment]) -> str:
    transcript_dir = Path(settings.transcript_dir)
    transcript_dir.mkdir(parents=True, exist_ok=True)
    dest = transcript_dir / f"{episode.id}.txt"

    def _fmt_time(secs: float) -> str:
        h = int(secs // 3600)
        m = int((secs % 3600) // 60)
        s = int(secs % 60)
        return f"{h:02d}:{m:02d}:{s:02d}"

    lines = ["# Podlog Transcript"]
    if episode.title:
        lines.append(f"# Episode: {episode.title}")
    if not episode.has_diarization:
        reason = episode.diarization_error or "unknown"
        lines.append(f"# Diarization: FAILED ({reason})")
    lines.append("")

    for seg in segments:
        ts = f"[{_fmt_time(seg.start_time)} - {_fmt_time(seg.end_time)}]"
        if episode.has_diarization and seg.speaker_label:
            lines.append(f"{ts} {seg.speaker_label}: {seg.text}")
        else:
            lines.append(f"{ts} {seg.text}")

    dest.write_text("\n".join(lines), encoding="utf-8")
    return str(dest)
