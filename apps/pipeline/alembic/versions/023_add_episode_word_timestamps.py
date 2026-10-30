"""Record where each episode's word timestamps came from (#1093).

``word_timestamps`` is ``wav2vec2`` (WhisperX alignment model), ``native``
(faster-whisper's own word times, for languages with no alignment model) or
``none`` (no word times; diarization assigned one speaker per segment).
NULL means the episode was transcribed before this column existed.

Additive and nullable, so the downgrade only drops the column.
"""

from alembic import op
import sqlalchemy as sa


revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("episodes", sa.Column("word_timestamps", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "word_timestamps")
