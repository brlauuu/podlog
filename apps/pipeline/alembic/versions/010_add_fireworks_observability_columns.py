"""Add Fireworks observability columns to episodes.

Tracks per-episode remote inference usage and estimated STT cost.
"""

from alembic import op
import sqlalchemy as sa


revision = "010"
down_revision = ("009", "4298a0b3990f")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("episodes", sa.Column("inference_provider_used", sa.Text(), nullable=True))
    op.add_column("episodes", sa.Column("fireworks_audio_secs", sa.Float(), nullable=True))
    op.add_column("episodes", sa.Column("fireworks_audio_minutes", sa.Float(), nullable=True))
    op.add_column("episodes", sa.Column("fireworks_stt_cost_per_minute_usd", sa.Float(), nullable=True))
    op.add_column("episodes", sa.Column("fireworks_stt_cost_usd", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "fireworks_stt_cost_usd")
    op.drop_column("episodes", "fireworks_stt_cost_per_minute_usd")
    op.drop_column("episodes", "fireworks_audio_minutes")
    op.drop_column("episodes", "fireworks_audio_secs")
    op.drop_column("episodes", "inference_provider_used")
