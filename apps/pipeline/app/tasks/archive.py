"""
Archive task -- PRD-01 S5.7, S5.8

- Compresses audio to MP3 64kbps
- Writes flat .txt transcript file (with or without speaker labels)
- Marks episode done
- Handles disk-full during archival: marks FAILED, preserves raw audio
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Segment, SpeakerName
from app.services.events import bus
from app.services.notifications import EpisodeDoneEvent, compute_avg_duration, compute_avg_processing_stats, estimate_queue_status
from app.tasks.helpers import mark_failed, update_episode

logger = logging.getLogger(__name__)


def archive_episode(episode_id: str) -> str:
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        update_episode(db, episode_id, status="archiving")

        raw_path = Path(episode.audio_local_path) if episode.audio_local_path else None

        # Archive audio (if enabled)
        archived_path = None
        if settings.archive_audio and raw_path and raw_path.exists():
            try:
                archived_path = _compress_audio(raw_path, episode_id)
            except OSError as exc:
                if "No space left on device" in str(exc) or getattr(exc, "errno", None) == 28:
                    mark_failed(
                        db, episode_id,
                        error_class="DISK_FULL",
                        error_message="Disk full during archival. Free space and retry.",
                    )
                    return episode_id
                raise

        # Write flat .txt transcript (PRD-04 S4.7: include inferred names)
        segments = (
            db.query(Segment)
            .filter(Segment.episode_id == episode_id)
            .order_by(Segment.start_time)
            .all()
        )
        speaker_names = (
            db.query(SpeakerName)
            .filter(SpeakerName.episode_id == episode_id)
            .all()
        )
        name_map = {sn.speaker_label: sn for sn in speaker_names}

        if not segments:
            mark_failed(
                db, episode_id,
                error_class="SYSTEM_ERROR",
                error_message="No transcript segments found at archival -- cannot mark done.",
            )
            return episode_id

        transcript_path = _write_transcript(episode, segments, name_map)

        update_episode(
            db, episode_id,
            status="done",
            audio_local_path=str(archived_path) if archived_path else None,
            transcript_path=transcript_path,
            processed_at=datetime.now(timezone.utc),
        )

        # Verify status was persisted before deleting raw audio
        db.expire_all()
        verified = db.query(Episode).filter(Episode.id == episode_id).first()
        if verified is None or verified.status != "done":
            logger.error(
                '"action": "archive_status_verify_failed", "episode_id": "%s", "status": "%s"',
                episode_id, verified.status if verified else "NOT_FOUND",
            )
            raise RuntimeError(
                f"Episode {episode_id} status update to 'done' did not persist "
                f"(current status: {verified.status if verified else 'NOT_FOUND'})"
            )

        # Emit notification event
        remaining, estimated, factor = estimate_queue_status(db)
        avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
        avg_dur = compute_avg_duration(db)
        # Notification "Total" should reflect active speech-processing time, not
        # queue age or pre-transcription waiting. Sum the measured stage durations.
        measured_durations = [
            secs
            for secs in (episode.transcribe_duration_secs, episode.diarize_duration_secs)
            if secs is not None
        ]
        total_secs = sum(measured_durations) if measured_durations else None
        bus.emit(EpisodeDoneEvent(
            episode_id=episode_id,
            episode_title=episode.title or "",
            podcast_title=episode.feed.title if episode.feed else "",
            published_at=episode.published_at,
            duration_secs=episode.duration_secs,
            transcribe_duration_secs=episode.transcribe_duration_secs,
            diarize_duration_secs=episode.diarize_duration_secs,
            total_duration_secs=total_secs,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
            avg_transcribe_secs=avg_t,
            avg_diarize_secs=avg_d,
            avg_total_secs=avg_total,
            avg_duration_secs=avg_dur,
            processing_factor=factor,
        ))

        # Safe to delete raw audio now that status is confirmed
        if raw_path and raw_path.exists():
            raw_path.unlink()

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


def _write_transcript(
    episode: Episode, segments: list[Segment], name_map: dict[str, "SpeakerName"] | None = None
) -> str:
    """Write flat .txt transcript file. Uses inferred names where available (PRD-04 S4.7)."""
    transcript_dir = Path(settings.transcript_dir)
    transcript_dir.mkdir(parents=True, exist_ok=True)
    dest = transcript_dir / f"{episode.id}.txt"
    name_map = name_map or {}

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

    # PRD-04 S4.7: header with inferred host/guest names
    host_sn = name_map.get("SPEAKER_00")
    if host_sn and host_sn.inferred:
        lines.append(f"# Host: {host_sn.display_name} (inferred)")
    guests = [
        sn for label, sn in sorted(name_map.items())
        if label != "SPEAKER_00" and sn.inferred
    ]
    if guests:
        guest_names = ", ".join(f"{g.display_name} (inferred)" for g in guests)
        lines.append(f"# Guests: {guest_names}")

    lines.append("")

    for seg in segments:
        ts = f"[{_fmt_time(seg.start_time)} - {_fmt_time(seg.end_time)}]"
        if episode.has_diarization and seg.speaker_label:
            sn = name_map.get(seg.speaker_label)
            display = sn.display_name if sn else seg.speaker_label
            lines.append(f"{ts} {display}: {seg.text}")
        else:
            lines.append(f"{ts} {seg.text}")

    dest.write_text("\n".join(lines), encoding="utf-8")
    return str(dest)
