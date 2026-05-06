"""Add prompt_settings table for LLM system prompt overrides.

Issue #643. Sparse table — a row exists only when the user has overridden the
build-time default. ``key`` matches an entry in ``services.prompts.PROMPT_KEYS``;
``value`` is the override text. Reset deletes the row so the value falls back to
the env var configured in ``app.config.Settings``.
"""

from alembic import op
import sqlalchemy as sa


revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prompt_settings",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("prompt_settings")
