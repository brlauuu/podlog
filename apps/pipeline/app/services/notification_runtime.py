"""Runtime notification payload helpers used by task execution paths."""
from sqlalchemy.orm import Session

from app.models import Episode
from app.services.events import bus
from app.services.notification_events import EpisodeDoneEvent, EpisodeFailedEvent
from app.services.notification_settings import get_runtime_inference_settings


def compute_avg_processing_stats(
    db: Session, provider: str | None = None
) -> tuple[float | None, float | None, float | None]:
    """Compute average processing times across done episodes.

    If provider is set, only includes episodes with that inference_provider_used value.
    """
    q = db.query(Episode).filter(
        Episode.status == "done",
        Episode.processed_at.isnot(None),
    )
    if provider is not None:
        q = q.filter(Episode.inference_provider_used == provider)
    done_episodes = q.all()

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


def compute_avg_duration(db: Session, provider: str | None = None) -> float | None:
    """Compute average episode audio duration across done episodes.

    If provider is set, only includes episodes with that inference_provider_used value.
    """
    q = db.query(Episode).filter(
        Episode.status == "done",
        Episode.duration_secs.isnot(None),
    )
    if provider is not None:
        q = q.filter(Episode.inference_provider_used == provider)
    done_episodes = q.all()
    if not done_episodes:
        return None
    return sum(ep.duration_secs for ep in done_episodes) / len(done_episodes)


def compute_avg_processing_factor(db: Session, provider: str | None = None) -> float | None:
    """Compute avg processing factor (processing_secs / audio_secs) across done episodes.

    If provider is set, only includes episodes with that inference_provider_used value.
    """
    q = db.query(Episode).filter(
        Episode.status == "done",
        Episode.processed_at.isnot(None),
        Episode.duration_secs.isnot(None),
    )
    if provider is not None:
        q = q.filter(Episode.inference_provider_used == provider)
    done_episodes = q.all()

    total_processing = 0.0
    total_audio = 0.0
    for ep in done_episodes:
        processing_secs = (ep.transcribe_duration_secs or 0) + (ep.diarize_duration_secs or 0)
        if processing_secs <= 0 or not ep.duration_secs:
            continue
        total_processing += processing_secs
        total_audio += ep.duration_secs

    if total_audio == 0:
        return None
    return total_processing / total_audio


def estimate_queue_status(
    db: Session, provider: str | None = None
) -> tuple[int, float | None, float | None]:
    """Return (remaining_count, estimated_seconds_to_complete, processing_factor).

    The rate is the duration-weighted average of the 10 most recent completed
    episodes. If ``provider`` is set, the sample is restricted to episodes
    processed by that inference provider so the ETA reflects the active
    setting (a queue that will run on Fireworks shouldn't be estimated from
    slow local-CPU history, and vice versa). Falls back to all-providers
    when there is no provider-matching history yet.
    """
    remaining = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .count()
    )

    def _recent_for(p: str | None):
        q = db.query(Episode).filter(
            Episode.status == "done",
            Episode.processed_at.isnot(None),
            Episode.duration_secs.isnot(None),
        )
        if p is not None:
            q = q.filter(Episode.inference_provider_used == p)
        return q.order_by(Episode.processed_at.desc()).limit(10).all()

    recent = _recent_for(provider) if provider else _recent_for(None)
    if provider and not recent:
        recent = _recent_for(None)

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


def _compute_episode_processing_factor(
    total_processing_secs: float | None, duration_secs: int | None
) -> float | None:
    """Return processing_secs / audio_secs for a single episode."""
    if total_processing_secs is None or not duration_secs:
        return None
    return total_processing_secs / duration_secs


def emit_episode_done_event(db: Session, episode: Episode) -> None:
    """Emit EpisodeDoneEvent using runtime queue/average stats.

    Averages are scoped to the episode's inference provider so that fast remote
    runs don't skew the average shown next to a slow local run (or vice versa).
    """
    provider = episode.inference_provider_used
    active_provider = get_runtime_inference_settings(db).get("inference_provider")
    remaining, estimated, _ = estimate_queue_status(db, provider=active_provider)
    avg_t, avg_d, avg_total = compute_avg_processing_stats(db, provider=provider)
    avg_dur = compute_avg_duration(db, provider=provider)
    avg_factor = compute_avg_processing_factor(db, provider=provider)
    total_secs = _compute_total_processing_duration_secs(episode)
    episode_factor = _compute_episode_processing_factor(total_secs, episode.duration_secs)
    bus.emit(
        EpisodeDoneEvent(
            episode_id=episode.id,
            episode_title=episode.title or "",
            podcast_title=episode.feed.title if episode.feed else "",
            published_at=episode.published_at,
            duration_secs=episode.duration_secs,
            transcribe_duration_secs=episode.transcribe_duration_secs,
            diarize_duration_secs=episode.diarize_duration_secs,
            diarize_step_durations=episode.diarize_step_durations,
            total_duration_secs=total_secs,
            inference_provider_used=provider,
            episode_processing_factor=episode_factor,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
            queue_estimate_provider=active_provider,
            avg_transcribe_secs=avg_t,
            avg_diarize_secs=avg_d,
            avg_total_secs=avg_total,
            avg_duration_secs=avg_dur,
            processing_factor=avg_factor,
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
    provider = episode.inference_provider_used
    active_provider = get_runtime_inference_settings(db).get("inference_provider")
    remaining, estimated, _ = estimate_queue_status(db, provider=active_provider)
    avg_t, avg_d, avg_total = compute_avg_processing_stats(db, provider=provider)
    avg_dur = compute_avg_duration(db, provider=provider)
    avg_factor = compute_avg_processing_factor(db, provider=provider)
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
            inference_provider_used=provider,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
            queue_estimate_provider=active_provider,
            avg_transcribe_secs=avg_t,
            avg_diarize_secs=avg_d,
            avg_total_secs=avg_total,
            avg_duration_secs=avg_dur,
            processing_factor=avg_factor,
        )
    )
