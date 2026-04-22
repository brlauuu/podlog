"""Add feed_speaker_cache table (PRD-04 C1/C2).

Per-feed cache of user-confirmed (speaker_label → display_name) mappings.
Populated automatically on rename (web API) and queried at inference time
to seed HIGH-confidence candidates for new episodes of the same feed.

Backfills from existing speaker_names rows where confirmed_by_user=true.
"""

from alembic import op
import sqlalchemy as sa


revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feed_speaker_cache",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "feed_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("feeds.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("speaker_label", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("normalized_name", sa.Text(), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "last_seen_episode_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("episodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "feed_id",
            "speaker_label",
            "normalized_name",
            name="uq_feed_speaker_cache_label_name",
        ),
    )
    op.create_index(
        "idx_feed_speaker_cache_feed_id",
        "feed_speaker_cache",
        ["feed_id"],
    )

    # Backfill from existing user-confirmed speaker_names. Group by
    # (feed_id, speaker_label, normalized_name) so historical renames for
    # the same name at the same label aggregate into occurrence_count.
    # normalize_name mirrors app.services.inference_helpers.normalize_name:
    # lower + collapse whitespace + strip up to two leading honorifics
    # (dr/mr/mrs/ms/mx/prof/sir/madam/rev/fr/sr/st, with optional trailing
    # punctuation). Two nested regexp_replace passes handle "Dr. Prof. ..."
    # style double-honorifics; a single pass covers the common case.
    op.execute(
        """
        INSERT INTO feed_speaker_cache (
            id, feed_id, speaker_label, display_name, normalized_name,
            occurrence_count, last_seen_episode_id, last_seen_at, created_at
        )
        SELECT
            gen_random_uuid()::text,
            e.feed_id,
            sn.speaker_label,
            (array_agg(sn.display_name ORDER BY e.published_at DESC NULLS LAST, e.id DESC))[1]
                AS display_name,
            regexp_replace(
                regexp_replace(
                    lower(regexp_replace(btrim(sn.display_name), '\\s+', ' ', 'g')),
                    '^(dr|mr|mrs|ms|mx|prof|sir|madam|rev|fr|sr|st)[.,:]* ',
                    ''
                ),
                '^(dr|mr|mrs|ms|mx|prof|sir|madam|rev|fr|sr|st)[.,:]* ',
                ''
            ) AS normalized_name,
            COUNT(*) AS occurrence_count,
            (array_agg(e.id ORDER BY e.published_at DESC NULLS LAST, e.id DESC))[1]
                AS last_seen_episode_id,
            COALESCE(MAX(e.published_at), NOW()) AS last_seen_at,
            NOW() AS created_at
        FROM speaker_names sn
        JOIN episodes e ON e.id = sn.episode_id
        WHERE sn.confirmed_by_user = true
          AND e.feed_id IS NOT NULL
          AND btrim(sn.display_name) <> ''
        GROUP BY e.feed_id, sn.speaker_label,
                 regexp_replace(
                     regexp_replace(
                         lower(regexp_replace(btrim(sn.display_name), '\\s+', ' ', 'g')),
                         '^(dr|mr|mrs|ms|mx|prof|sir|madam|rev|fr|sr|st)[.,:]* ',
                         ''
                     ),
                     '^(dr|mr|mrs|ms|mx|prof|sir|madam|rev|fr|sr|st)[.,:]* ',
                     ''
                 )
        """
    )


def downgrade() -> None:
    op.drop_index("idx_feed_speaker_cache_feed_id", table_name="feed_speaker_cache")
    op.drop_table("feed_speaker_cache")
