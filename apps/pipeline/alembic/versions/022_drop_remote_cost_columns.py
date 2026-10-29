"""Drop the remote-inference cost and usage columns from episodes (#1092).

Remote inference is gone, so nothing writes or reads these any more. They held
Fireworks billed-audio figures and estimated costs (migration 010) and the
pyannote.ai cost estimate (migration 016). ``inference_provider_used`` stays:
it drives the "Transcribed remotely" tag on episodes from before the removal.

The downgrade restores the columns empty. The values themselves come back
only by restoring a database dump taken before this migration ran.
"""

from alembic import op
import sqlalchemy as sa


revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None

_COLUMNS = (
    "fireworks_audio_secs",
    "fireworks_audio_minutes",
    "fireworks_stt_cost_per_minute_usd",
    "fireworks_stt_cost_usd",
    "pyannote_cloud_cost_usd",
)


def upgrade() -> None:
    for column in _COLUMNS:
        op.drop_column("episodes", column)


def downgrade() -> None:
    for column in _COLUMNS:
        op.add_column("episodes", sa.Column(column, sa.Float(), nullable=True))
