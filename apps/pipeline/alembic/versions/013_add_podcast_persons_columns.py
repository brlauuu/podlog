"""Add <podcast:person> JSONB columns to feeds and episodes (PRD-04 B2).

Stores the Podcasting 2.0 namespace <podcast:person> tags as a JSONB list
of {name, role, group, href?, img?} objects. Parsed directly from raw RSS
XML (feedparser's handler only keeps the last occurrence). Used to seed
inference with HIGH-confidence host/guest candidates.

Both columns nullable; existing rows remain NULL and get populated on the
next feed poll.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("feeds", sa.Column("podcast_persons", JSONB(), nullable=True))
    op.add_column("episodes", sa.Column("podcast_persons", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "podcast_persons")
    op.drop_column("feeds", "podcast_persons")
