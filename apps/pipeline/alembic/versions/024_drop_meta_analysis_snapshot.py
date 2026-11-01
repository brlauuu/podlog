"""Drop meta_analysis_snapshot and its stale flag (#1134).

The Meta-Analysis page is removed. Its snapshot table (migration 015) was a
cache recomputed from segments and speaker_names, so nothing is lost by
dropping it. The `meta_analysis_stale` key in system_state went with it.

Downgrade recreates the empty table as 015 defined it and sets the stale
flag, so the previous release's worker recomputes the snapshot when idle.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("meta_analysis_snapshot")
    op.execute("DELETE FROM system_state WHERE key = 'meta_analysis_stale'")


def downgrade() -> None:
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
    op.execute(
        "INSERT INTO system_state (key, value) VALUES ('meta_analysis_stale', 'downgrade') "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
    )
