"""
SQLAlchemy ORM models — mirrors the schema defined in PRD-01 §7.

Changes vs PRD-01 v1.1:
- episodes.updated_at added (needed for GAP-01 zombie job detection)
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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

    # Job state machine: pending → downloading → transcribing → diarizing → archiving → done / failed
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

    # Celery task reference
    celery_task_id: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    processed_at: Mapped[datetime | None] = mapped_column()

    feed: Mapped["Feed | None"] = relationship("Feed", back_populates="episodes")
    segments: Mapped[list["Segment"]] = relationship(
        "Segment", back_populates="episode", cascade="all, delete-orphan"
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
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    episode: Mapped["Episode"] = relationship("Episode", back_populates="segments")


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
