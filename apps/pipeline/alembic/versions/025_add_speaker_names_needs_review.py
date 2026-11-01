"""Add speaker_names.needs_review (#1133).

Set on a confirmed name when its episode's segments are rebuilt by a
re-process: the speaker labels are renumbered, so the name may now be on a
different voice. Cleared when the user edits the speaker. Existing rows start
false: nothing has been re-processed under this rule yet.
"""
from alembic import op
import sqlalchemy as sa


revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "speaker_names",
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("speaker_names", "needs_review")
