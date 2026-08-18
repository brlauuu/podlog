"""Materialize speaker turns into a real table (#942).

Search grouped segments into speaker turns with a CTE that ran over the
*whole* segments table on every query: two window functions, a string_agg,
and only then the text-search predicate. Because ``full_text`` was built at
query time, ``to_tsvector`` was recomputed for the entire corpus on each
request and no index could apply. Measured on 893k segments that was
15.8 s per query, and search issues two of them.

This creates the same rows as a table, with the tsvector stored and a GIN
index over it. The same count query then runs in 8 ms.

``rebuild_speaker_turns(uuid)`` holds the turn-boundary logic. It lives in
the database on purpose: the pipeline (Python) and the speaker-merge route
(TypeScript) both have to rebuild turns, and keeping one copy in SQL avoids
the cross-runtime divergence that CLAUDE.md warns about for duplicated
normalization helpers.

Nothing reads the table in this migration's PR — the query rewrite is
separate, so this can be verified against the CTE before anything depends
on it.
"""

from alembic import op
import sqlalchemy as sa


revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speaker_turns",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("episode_id", sa.dialects.postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("speaker_label", sa.Text(), nullable=True),
        sa.Column("turn_num", sa.Integer(), nullable=False),
        sa.Column("min_id", sa.BigInteger(), nullable=False),
        sa.Column("start_time", sa.Float(), nullable=False),
        sa.Column("end_time", sa.Float(), nullable=False),
        sa.Column("full_text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["episode_id"], ["episodes.id"], ondelete="CASCADE"),
    )

    # Stored, not computed per query — this is the entire point of the change.
    op.execute(
        """
        ALTER TABLE speaker_turns
        ADD COLUMN fts tsvector
        GENERATED ALWAYS AS (to_tsvector('english', full_text)) STORED
        """
    )

    op.create_index("speaker_turns_fts", "speaker_turns", ["fts"], postgresql_using="gin")
    op.create_index("speaker_turns_episode_id", "speaker_turns", ["episode_id"])
    op.create_index("speaker_turns_start_time", "speaker_turns", ["start_time"])
    op.create_unique_constraint(
        "speaker_turns_episode_turn_uniq", "speaker_turns", ["episode_id", "turn_num"]
    )

    # Single source of truth for turn boundaries: consecutive same-speaker
    # runs within an episode. NULL speaker_label is compared with IS DISTINCT
    # FROM (not <>) so an undiarized episode collapses into one turn rather
    # than one turn per segment.
    #
    # Ordering is (start_time, id), not start_time alone. 2,564 segments
    # across 1,238 groups share an (episode_id, start_time), and the CTE this
    # replaces ordered only by start_time -- an incomplete sort key, so the
    # window functions saw an arbitrary row order. Running that CTE twice in
    # one transaction over unchanged data produced 551 differing turns. Turn
    # boundaries decide search dedup and snippet text, so search results were
    # quietly unstable between identical queries. Adding the primary key as a
    # tie-break makes the order total and the output reproducible.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION rebuild_speaker_turns(p_episode_id uuid)
        RETURNS integer AS $$
        DECLARE
          inserted integer;
        BEGIN
          DELETE FROM speaker_turns WHERE episode_id = p_episode_id;

          WITH lagged AS (
            SELECT s.id, s.episode_id, s.speaker_label, s.start_time, s.end_time, s.text,
              CASE WHEN s.speaker_label IS DISTINCT FROM
                LAG(s.speaker_label) OVER (PARTITION BY s.episode_id ORDER BY s.start_time, s.id)
                THEN 1 ELSE 0 END AS is_new_turn
            FROM segments s
            WHERE s.episode_id = p_episode_id
          ),
          turn_numbered AS (
            SELECT l.*,
              SUM(is_new_turn) OVER (PARTITION BY episode_id ORDER BY start_time, id) AS turn_num
            FROM lagged l
          )
          INSERT INTO speaker_turns
            (episode_id, speaker_label, turn_num, min_id, start_time, end_time, full_text)
          SELECT
            episode_id,
            speaker_label,
            turn_num,
            MIN(id),
            MIN(start_time),
            MAX(end_time),
            string_agg(text, ' ' ORDER BY start_time, id)
          FROM turn_numbered
          GROUP BY episode_id, speaker_label, turn_num;

          GET DIAGNOSTICS inserted = ROW_COUNT;
          RETURN inserted;
        END;
        $$ LANGUAGE plpgsql
        """
    )

    # Backfill every episode that already has segments. Measured at ~17s for
    # 985 episodes / 893k segments. Done per-episode through the same
    # function the runtime uses, so the backfill cannot drift from it.
    op.execute(
        """
        DO $$
        DECLARE
          ep uuid;
        BEGIN
          FOR ep IN SELECT DISTINCT episode_id FROM segments LOOP
            PERFORM rebuild_speaker_turns(ep);
          END LOOP;
        END $$
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS rebuild_speaker_turns(uuid)")
    op.drop_table("speaker_turns")
