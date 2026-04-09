"""Runtime notification payload helpers used by task execution paths."""
from sqlalchemy.orm import Session

from app.models import Episode
from app.services.events import bus
from app.services.notification_events import EpisodeDoneEvent, EpisodeFailedEvent


def compute_avg_processing_stats(db: Session) -> tuple[float | None, float | None, float | None]:
    """Compute average processing times across all completed episodes."""
    done_episodes = (
        db.query(Episode)
        .filter(
            Episode.status == "done",
            Episode.processed_at.isnot(None),
        )
        .all()
    )

    if not done_episodes:
        return None, None, None

    transcribe_vals = [ep.transcribe_duration_secs for ep in done_episodes if ep.transcribe_duration_secs is not None]
    diarize_vals = [ep.diarize_duration_secs for ep in done_episodes if ep.diarize_duration_secs is not None]
    total_vals = [
        (ep.transcribe_duration_secs or 0) + (ep.diarize_duration_secs or 0)
        for ep in done_episodes
        if ep.transcribe_duration_secs is not None or ep.diarize_duration_secs is not None
    ]

    avg_t = sum(transcribe_vals) / len(transcribe_vals) if transcribe_vals else None
    avg_d = sum(diarize_vals) / len(diarize_vals) if diarize_vals else None
    avg_total = sum(total_vals) / len(total_vals) if total_vals else None

    return avg_t, avg_d, avg_total


def compute_avg_duration(db: Session) -> float | None:
    """Compute average episode audio duration across all completed episodes."""
    done_episodes = (
        db.query(Episode)
        .filter(
            Episode.status == "done",
            Episode.duration_secs.isnot(None),
        )
        .all()
    )
    if not done_episodes:
        return None
    return sum(ep.duration_secs for ep in done_episodes) / len(done_episodes)


def estimate_queue_status(db: Session) -> tuple[int, float | None, float | None]:
    """Return (remaining_count, estimated_seconds_to_complete, processing_factor)."""
    remaining = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .count()
    )

    recent = (
        db.query(Episode)
        .filter(
            Episode.status == "done",
            Episode.processed_at.isnot(None),
            Episode.duration_secs.isnot(None),
        )
        .order_by(Episode.processed_at.desc())
        .limit(10)
        .all()
    )

    if not recent:
        return remaining, None, None

    total_processing = 0.0
    total_audio = 0.0
    for ep in recent:
        processing_secs = (ep.transcribe_duration_secs or 0) + (ep.diarize_duration_secs or 0)
        if processing_secs <= 0:
            continue
        total_processing += processing_secs
        total_audio += ep.duration_secs

    if total_audio == 0:
        return remaining, None, None

    rate = total_processing / total_audio

    queued_episodes = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .all()
    )
    queued_audio = sum(ep.duration_secs or 0 for ep in queued_episodes)

    return remaining, queued_audio * rate, rate


def _compute_total_processing_duration_secs(episode: Episode) -> float | None:
    """Compute active speech-processing duration from measured stages only."""
    measured_durations = [
        secs
        for secs in (episode.transcribe_duration_secs, episode.diarize_duration_secs)
        if secs is not None
    ]
    return sum(measured_durations) if measured_durations else None


def emit_episode_done_event(db: Session, episode: Episode) -> None:
    """Emit EpisodeDoneEvent using runtime queue/average stats."""
    remaining, estimated, factor = estimate_queue_status(db)
    avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
    avg_dur = compute_avg_duration(db)
    total_secs = _compute_total_processing_duration_secs(episode)
    bus.emit(
        EpisodeDoneEvent(
            episode_id=episode.id,
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
        )
    )


def emit_episode_failed_event(
    db: Session,
    episode: Episode,
    *,
    error_class: str,
    error_message: str,
) -> None:
    """Emit EpisodeFailedEvent using runtime queue/average stats."""
    remaining, estimated, factor = estimate_queue_status(db)
    avg_t, avg_d, avg_total = compute_avg_processing_stats(db)
    avg_dur = compute_avg_duration(db)
    bus.emit(
        EpisodeFailedEvent(
            episode_id=episode.id,
            episode_title=episode.title or "",
            podcast_title=episode.feed.title if episode.feed else "",
            published_at=episode.published_at,
            duration_secs=episode.duration_secs,
            error_class=error_class,
            error_message=error_message,
            retry_count=episode.retry_count,
            retry_max=episode.retry_max,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
            avg_transcribe_secs=avg_t,
            avg_diarize_secs=avg_d,
            avg_total_secs=avg_total,
            avg_duration_secs=avg_dur,
            processing_factor=factor,
        )
    )
