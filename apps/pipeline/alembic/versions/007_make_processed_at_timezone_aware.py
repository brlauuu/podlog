"""Make episodes.processed_at timezone-aware.

Aligns the column type with other timestamp columns (e.g. Job.created_at,
Job.retry_at) that already use TIMESTAMP WITH TIME ZONE.
"""

from alembic import op


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE episodes "
        "ALTER COLUMN processed_at TYPE TIMESTAMP WITH TIME ZONE "
        "USING processed_at AT TIME ZONE 'UTC'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE episodes "
        "ALTER COLUMN processed_at TYPE TIMESTAMP WITHOUT TIME ZONE"
    )
