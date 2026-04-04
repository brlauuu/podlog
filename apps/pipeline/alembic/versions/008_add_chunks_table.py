"""Add chunks table for RAG speaker-turn chunking.

Merged speaker-turn segments (~400 tokens each) with embeddings for
higher-quality RAG retrieval. See issue #114.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chunks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "episode_id",
            UUID(as_uuid=False),
            sa.ForeignKey("episodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("speaker_label", sa.Text()),
        sa.Column("start_time", sa.Float(), nullable=False),
        sa.Column("end_time", sa.Float(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("segment_ids", sa.ARRAY(sa.BigInteger()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # pgvector column — no Alembic typed helper available (same pattern as migration 006)
    op.execute("ALTER TABLE chunks ADD COLUMN embedding vector(384)")

    op.create_index("idx_chunks_episode_id", "chunks", ["episode_id"])
    op.create_index("idx_chunks_start_time", "chunks", ["episode_id", "start_time"])

    # HNSW index requires raw SQL — pgvector operator class not available via Alembic helpers
    op.execute(
        "CREATE INDEX chunks_embedding_hnsw "
        "ON chunks USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.drop_index("chunks_embedding_hnsw", table_name="chunks")
    op.drop_index("idx_chunks_start_time", table_name="chunks")
    op.drop_index("idx_chunks_episode_id", table_name="chunks")
    op.drop_table("chunks")
