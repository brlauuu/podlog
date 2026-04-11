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
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None
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
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None
    avg_transcribe_secs: float | None = None
    avg_diarize_secs: float | None = None
    avg_total_secs: float | None = None
    avg_duration_secs: float | None = None
    processing_factor: float | None = None
