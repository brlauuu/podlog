"""Add notification_log table for digest delivery.

The NotificationLog model was added in app/models.py but no migration
created the underlying table. Fixes finding #1 from issue #104.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column(
            "episode_id",
            UUID(as_uuid=False),
            sa.ForeignKey("episodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("sent", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_index(
        "idx_notification_log_unsent",
        "notification_log",
        ["sent", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_notification_log_unsent", table_name="notification_log")
    op.drop_table("notification_log")
