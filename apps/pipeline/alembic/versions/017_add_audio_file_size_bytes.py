"""Add audio_file_size_bytes column to episodes.

Records the size in bytes of the audio file that was actually processed by the
transcription step (WAV for local Whisper, raw download for Fireworks). Nullable
so existing episodes remain valid pending a backfill.
"""

from alembic import op
import sqlalchemy as sa


revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("episodes", sa.Column("audio_file_size_bytes", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "audio_file_size_bytes")
