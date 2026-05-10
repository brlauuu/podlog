"""Add role column to speaker_names (#698).

Issue #698. Lets the user assign each speaker a role per episode:
``host``, ``guest``, or ``other``. NULL means unassigned. The column is
nullable since existing rows have no role yet — backfill is purely
user-driven via the speaker cards.
"""

from alembic import op
import sqlalchemy as sa


revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("speaker_names", sa.Column("role", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("speaker_names", "role")
