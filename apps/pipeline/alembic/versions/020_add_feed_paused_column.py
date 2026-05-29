"""Add paused column to feeds (#743).

Issue #743. Lets the user pause ingestion of new episodes for a feed
without losing the already-processed ones. Default false so existing
feeds keep polling.
"""

from alembic import op
import sqlalchemy as sa


revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feeds",
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("feeds", "paused")
