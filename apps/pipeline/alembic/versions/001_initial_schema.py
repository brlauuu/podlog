"""Initial schema — feeds, episodes, segments, speaker_names

Revision ID: 001
Revises:
Create Date: 2026-02-25

Tables: feeds, episodes, segments, speaker_names
Indexes: GIN FTS on segments.text, btree on segments.episode_id and segments.start_time
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- feeds
    op.create_table(
        "feeds",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("url", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text()),
        sa.Column("description", sa.Text()),
        sa.Column("image_url", sa.Text()),
        sa.Column("website_url", sa.Text()),
        sa.Column("last_polled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # -- episodes
    op.create_table(
        "episodes",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("feed_id", UUID(as_uuid=False), sa.ForeignKey("feeds.id", ondelete="CASCADE"), nullable=True),
        sa.Column("guid", sa.Text(), nullable=False),
        sa.Column("title", sa.Text()),
        sa.Column("description", sa.Text()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("duration_secs", sa.Integer()),
        sa.Column("audio_url", sa.Text(), nullable=False),
        sa.Column("audio_local_path", sa.Text()),
        sa.Column("transcript_path", sa.Text()),
        sa.Column("language", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text()),
        sa.Column("error_class", sa.Text()),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_max", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("has_diarization", sa.Boolean(), server_default="false"),
        sa.Column("diarization_error", sa.Text()),
        sa.Column("celery_task_id", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("feed_id", "guid", name="uq_episode_feed_guid"),
    )

    # -- segments (core searchable content)
    op.create_table(
        "segments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("episode_id", UUID(as_uuid=False), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("speaker_label", sa.Text()),
        sa.Column("start_time", sa.Float(), nullable=False),
        sa.Column("end_time", sa.Float(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # -- speaker name customization
    op.create_table(
        "speaker_names",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("episode_id", UUID(as_uuid=False), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("speaker_label", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.UniqueConstraint("episode_id", "speaker_label", name="uq_speaker_episode_label"),
    )

    # -- indexes for search performance (PRD-01 §7)
    op.execute(
        "CREATE INDEX segments_text_fts ON segments USING GIN(to_tsvector('english', text))"
    )
    op.create_index("segments_episode_id", "segments", ["episode_id"])
    op.create_index("segments_start_time", "segments", ["start_time"])


def downgrade() -> None:
    op.drop_index("segments_start_time", table_name="segments")
    op.drop_index("segments_episode_id", table_name="segments")
    op.execute("DROP INDEX IF EXISTS segments_text_fts")
    op.drop_table("speaker_names")
    op.drop_table("segments")
    op.drop_table("episodes")
    op.drop_table("feeds")
