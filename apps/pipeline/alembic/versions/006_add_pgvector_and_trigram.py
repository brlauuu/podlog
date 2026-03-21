"""Add pgvector and pg_trgm extensions, embedding column, and indexes.

Supports search improvements: semantic vector search (Level 3) and
fuzzy trigram matching (Level 2).
"""

from alembic import op


revision = "006"
down_revision = "4298a0b3990f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute("ALTER TABLE segments ADD COLUMN IF NOT EXISTS embedding vector(384)")

    # HNSW index for fast approximate nearest neighbor search
    op.execute(
        "CREATE INDEX IF NOT EXISTS segments_embedding_hnsw "
        "ON segments USING hnsw (embedding vector_cosine_ops)"
    )

    # Trigram index for fuzzy text matching
    op.execute(
        "CREATE INDEX IF NOT EXISTS segments_text_trgm "
        "ON segments USING GIN(text gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS segments_text_trgm")
    op.execute("DROP INDEX IF EXISTS segments_embedding_hnsw")
    op.execute("ALTER TABLE segments DROP COLUMN IF EXISTS embedding")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
    op.execute("DROP EXTENSION IF EXISTS vector")
