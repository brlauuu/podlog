"""Add RSS person-tag columns to feeds and episodes (PRD-04 B1 + B3).

- feeds.itunes_author: from <itunes:author> / <author> at channel level
- feeds.itunes_owner_name: from <itunes:owner><itunes:name>
- episodes.episode_author: from <dc:creator> / <itunes:author> / <author> at item level

All nullable; existing rows stay NULL and get populated on next feed poll.
"""

from alembic import op
import sqlalchemy as sa


revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("feeds", sa.Column("itunes_author", sa.Text(), nullable=True))
    op.add_column("feeds", sa.Column("itunes_owner_name", sa.Text(), nullable=True))
    op.add_column("episodes", sa.Column("episode_author", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("episodes", "episode_author")
    op.drop_column("feeds", "itunes_owner_name")
    op.drop_column("feeds", "itunes_author")
