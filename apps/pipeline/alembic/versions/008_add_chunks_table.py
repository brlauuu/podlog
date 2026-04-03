"""Add chunks table for RAG speaker-turn chunking.

Merged speaker-turn segments (~400 tokens each) with embeddings for
higher-quality RAG retrieval. See issue #114.
"""

from alembic import op


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE chunks (
            id BIGSERIAL PRIMARY KEY,
            episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
            speaker_label TEXT,
            start_time DOUBLE PRECISION NOT NULL,
            end_time DOUBLE PRECISION NOT NULL,
            text TEXT NOT NULL,
            segment_ids BIGINT[] NOT NULL,
            embedding vector(384),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
    """)

    # Indexes for common access patterns
    op.execute("CREATE INDEX idx_chunks_episode_id ON chunks (episode_id)")
    op.execute("CREATE INDEX idx_chunks_start_time ON chunks (episode_id, start_time)")

    # HNSW index for fast approximate nearest neighbor search on chunk embeddings
    op.execute(
        "CREATE INDEX chunks_embedding_hnsw "
        "ON chunks USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS chunks")
