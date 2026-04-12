"""
SQLAlchemy ORM models — mirrors the schema defined in PRD-01 §7.

Changes vs PRD-01 v1.1:
- episodes.updated_at added (needed for GAP-01 zombie job detection)
"""
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Feed(Base):
    __tablename__ = "feeds"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    website_url: Mapped[str | None] = mapped_column(Text)
    last_polled_at: Mapped[datetime | None] = mapped_column()
    # Issue #23: test | full — test mode limits to N most-recent episodes (default 1)
    # Issue #84: selective — only user-chosen episodes are ingested; not auto-polled
    mode: Mapped[str] = mapped_column(Text, nullable=False, default="full")

    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    episodes: Mapped[list["Episode"]] = relationship(
        "Episode", back_populates="feed", cascade="all, delete-orphan"
    )


class Episode(Base):
    __tablename__ = "episodes"
    __table_args__ = (UniqueConstraint("feed_id", "guid", name="uq_episode_feed_guid"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    feed_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("feeds.id", ondelete="CASCADE"), nullable=True
    )
    guid: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column()
    duration_secs: Mapped[int | None] = mapped_column(Integer)
    audio_url: Mapped[str] = mapped_column(Text, nullable=False)
    episode_url: Mapped[str | None] = mapped_column(Text)
    audio_local_path: Mapped[str | None] = mapped_column(Text)
    transcript_path: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(Text)

    # Job state machine: pending → downloading → transcribing → diarizing → chunking → embedding → inferring → archiving → done / failed
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text)
    error_class: Mapped[str | None] = mapped_column(Text)
    # Valid values: TRANSIENT_NETWORK | HTTP_ACCESS | DISK_FULL | OOM | SYSTEM_ERROR

    # Retry tracking
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_max: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Diarization result
    has_diarization: Mapped[bool] = mapped_column(Boolean, default=False)
    diarization_error: Mapped[str | None] = mapped_column(Text)

    # Inference result (PRD-04 §5.2)
    inference_skipped: Mapped[bool] = mapped_column(Boolean, default=False)
    inference_error: Mapped[str | None] = mapped_column(Text)

    # Processing duration (seconds)
    transcribe_duration_secs: Mapped[float | None] = mapped_column(Float)
    diarize_duration_secs: Mapped[float | None] = mapped_column(Float)
    diarize_step_durations: Mapped[dict[str, float] | None] = mapped_column(JSONB)

    # Remote inference observability (Issue #261)
    inference_provider_used: Mapped[str | None] = mapped_column(Text)
    fireworks_audio_secs: Mapped[float | None] = mapped_column(Float)
    fireworks_audio_minutes: Mapped[float | None] = mapped_column(Float)
    fireworks_stt_cost_per_minute_usd: Mapped[float | None] = mapped_column(Float)
    fireworks_stt_cost_usd: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    feed: Mapped["Feed | None"] = relationship("Feed", back_populates="episodes")
    segments: Mapped[list["Segment"]] = relationship(
        "Segment", back_populates="episode", cascade="all, delete-orphan"
    )
    chunks: Mapped[list["Chunk"]] = relationship(
        "Chunk", back_populates="episode", cascade="all, delete-orphan"
    )
    speaker_names: Mapped[list["SpeakerName"]] = relationship(
        "SpeakerName", back_populates="episode", cascade="all, delete-orphan"
    )


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str | None] = mapped_column(Text)
    # SPEAKER_00, SPEAKER_01, etc. — NULL if diarization unavailable
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Any | None] = mapped_column(Vector(384), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    episode: Mapped["Episode"] = relationship("Episode", back_populates="segments")


class Chunk(Base):
    """Merged speaker-turn segments for RAG retrieval.

    Consecutive same-speaker segments are merged into chunks of ~400 tokens.
    Speaker changes are chunk boundaries. Each chunk stores references to its
    source segment IDs for traceability.
    """

    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str | None] = mapped_column(Text)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    segment_ids: Mapped[list] = mapped_column(ARRAY(BigInteger), nullable=False)
    embedding: Mapped[Any | None] = mapped_column(Vector(384), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    episode: Mapped["Episode"] = relationship("Episode", back_populates="chunks")


class SpeakerName(Base):
    """User-defined display name for a speaker label within a specific episode."""

    __tablename__ = "speaker_names"
    __table_args__ = (
        UniqueConstraint("episode_id", "speaker_label", name="uq_speaker_episode_label"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)

    # PRD-04 §5.1: inference metadata
    inferred: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[str | None] = mapped_column(Text)  # HIGH | MEDIUM | LOW | NULL
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)

    episode: Mapped["Episode"] = relationship("Episode", back_populates="speaker_names")


class Job(Base):
    """DB-backed job queue — replaces Celery/Redis."""

    __tablename__ = "job_queue"
    __table_args__ = (
        Index(
            "idx_job_queue_poll",
            "status",
            "retry_at",
            "created_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    task: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SystemState(Base):
    """Simple key-value store for cross-container state (e.g. prewarm status)."""

    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class NotificationLog(Base):
    """Accumulated notification events for digest delivery."""

    __tablename__ = "notification_log"
    __table_args__ = (
        Index("idx_notification_log_unsent", "sent", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    episode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
