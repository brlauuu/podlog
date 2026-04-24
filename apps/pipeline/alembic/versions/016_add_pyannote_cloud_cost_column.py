"""Add pyannote cloud cost column to episodes.

Tracks per-episode estimated cost when diarization runs via pyannote.ai's
hosted precision-2 provider. Mirrors the Fireworks observability pattern
(see migration 010). Cloud is opt-in; column is nullable and stays NULL
for episodes processed with the local community-1 model.
"""

from alembic import op
import sqlalchemy as sa


revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("episodes", sa.Column("pyannote_cloud_cost_usd", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "pyannote_cloud_cost_usd")
