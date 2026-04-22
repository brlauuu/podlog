"""Add meta_analysis_snapshot single-row table (Issue #521).

Stores the precomputed dashboard snapshot as JSONB. CHECK (id = 1)
ensures at most one row. The stale flag reuses the existing
system_state kv table; no schema change required for it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meta_analysis_snapshot",
        sa.Column("id", sa.Integer(), primary_key=True, server_default="1"),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("episode_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("feed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("id = 1", name="ck_meta_analysis_snapshot_singleton"),
    )


def downgrade() -> None:
    op.drop_table("meta_analysis_snapshot")
