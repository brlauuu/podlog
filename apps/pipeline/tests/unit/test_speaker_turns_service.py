"""Unit tests for app.services.speaker_turns (#942)."""
from unittest.mock import MagicMock

from app.services import speaker_turns as st


class TestRebuildSpeakerTurns:
    def test_calls_the_sql_function_with_a_uuid_cast(self):
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = 42

        assert st.rebuild_speaker_turns(db, "ep-1") == 42

        sql = str(db.execute.call_args[0][0])
        # The cast matters: episode ids are text in Python but the column and
        # the function signature are uuid (the migration-014 lesson).
        assert "rebuild_speaker_turns" in sql
        assert "uuid" in sql.lower()
        assert db.execute.call_args[0][1] == {"eid": "ep-1"}

    def test_commits_so_turns_are_visible_to_other_sessions(self):
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = 1

        st.rebuild_speaker_turns(db, "ep-1")

        db.commit.assert_called_once()


class TestRebuildMissingSpeakerTurns:
    def _db_with_missing(self, episode_ids):
        db = MagicMock()
        first = MagicMock()
        first.scalars.return_value.all.return_value = episode_ids
        # Subsequent execute() calls are the per-episode rebuilds.
        rebuild = MagicMock()
        rebuild.scalar_one.return_value = 3
        db.execute.side_effect = [first] + [rebuild] * len(episode_ids)
        return db

    def test_rebuilds_each_episode_missing_turns(self):
        db = self._db_with_missing(["ep-1", "ep-2"])

        assert st.rebuild_missing_speaker_turns(db) == 2
        # 1 discovery query + 2 rebuilds
        assert db.execute.call_count == 3

    def test_does_nothing_when_every_episode_has_turns(self):
        db = self._db_with_missing([])

        assert st.rebuild_missing_speaker_turns(db) == 0
        assert db.execute.call_count == 1

    def test_discovery_query_is_bounded(self):
        # Unbounded, this would try to rebuild the whole corpus in one
        # periodic tick on a fresh install.
        db = self._db_with_missing([])
        st.rebuild_missing_speaker_turns(db, limit=7)

        sql = str(db.execute.call_args_list[0][0][0])
        assert "LIMIT" in sql.upper()
        assert db.execute.call_args_list[0][0][1] == {"lim": 7}

    def test_discovery_only_selects_episodes_with_no_turns_at_all(self):
        db = self._db_with_missing([])
        st.rebuild_missing_speaker_turns(db)

        sql = str(db.execute.call_args_list[0][0][0])
        assert "NOT EXISTS" in sql.upper()
        assert "speaker_turns" in sql
