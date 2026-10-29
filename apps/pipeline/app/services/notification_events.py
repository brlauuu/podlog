"""Notification event dataclasses."""
from dataclasses import dataclass
from datetime import datetime

from app.services.events import Event


@dataclass
class EpisodeDoneEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    transcribe_duration_secs: float | None = None
    diarize_duration_secs: float | None = None
    diarize_step_durations: dict[str, float] | None = None
    total_duration_secs: float | None = None
    inference_provider_used: str | None = None
    episode_processing_factor: float | None = None
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None
    queue_estimate_provider: str | None = None
    avg_transcribe_secs: float | None = None
    avg_diarize_secs: float | None = None
    avg_total_secs: float | None = None
    avg_duration_secs: float | None = None
    processing_factor: float | None = None


@dataclass
class EpisodeFailedEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    error_class: str = ""
    error_message: str = ""
    retry_count: int = 0
    retry_max: int = 3
    inference_provider_used: str | None = None
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None
    queue_estimate_provider: str | None = None
    avg_transcribe_secs: float | None = None
    avg_diarize_secs: float | None = None
    avg_total_secs: float | None = None
    avg_duration_secs: float | None = None
    processing_factor: float | None = None


@dataclass
class PipelineAlertEvent(Event):
    """A stage that keeps failing, or a queue that stopped moving (#1099).

    Built by services/pipeline_alerts.py, which decides what to say; the
    formatters in notifications.py only lay out ``headline`` and ``details``.
    """
    kind: str = ""  # "failure_streak" | "stall"
    stage: str | None = None
    recovered: bool = False
    headline: str = ""
    details: list[tuple[str, str]] | None = None
