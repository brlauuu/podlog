"""Unit tests for retrieve_chunks — the RAG DB query builder."""
from unittest.mock import ANY, MagicMock, patch


class TestRetrieveChunks:
    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_basic_retrieval(self, mock_embed):
        mock_row = MagicMock()
        mock_row.chunk_id = 1
        mock_row.episode_id = "ep-1"
        mock_row.episode_title = "Test Ep"
        mock_row.speaker_label = "SPEAKER_00"
        mock_row.start_time = 10.0
        mock_row.end_time = 20.0
        mock_row.text = "Hello world"
        mock_row.similarity = 0.8

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [mock_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "test question")

        assert len(results) == 1
        assert results[0].episode_title == "Test Ep"
        assert results[0].similarity == 0.8
        mock_embed.assert_called_once_with("test question", runtime=ANY)

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_filters_below_threshold(self, mock_embed):
        low_row = MagicMock()
        low_row.chunk_id = 1
        low_row.episode_id = "ep-1"
        low_row.episode_title = "Low"
        low_row.speaker_label = None
        low_row.start_time = 0.0
        low_row.end_time = 5.0
        low_row.text = "Low sim"
        low_row.similarity = 0.1  # Below SIMILARITY_THRESHOLD (0.3)

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [low_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "test")
        assert len(results) == 0

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_uses_untitled_for_null_title(self, mock_embed):
        mock_row = MagicMock()
        mock_row.chunk_id = 1
        mock_row.episode_id = "ep-1"
        mock_row.episode_title = None
        mock_row.speaker_label = None
        mock_row.start_time = 0.0
        mock_row.end_time = 5.0
        mock_row.text = "text"
        mock_row.similarity = 0.9

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [mock_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "q")
        assert results[0].episode_title == "Untitled Episode"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_feed_ids_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["feed-1", "feed-2"])

        # Check the SQL includes feed filter params
        call_args = mock_db.execute.call_args
        params = call_args[0][1]
        assert params["fid_0"] == "feed-1"
        assert params["fid_1"] == "feed-2"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_uploads_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["__uploads__"])

        # SQL should include IS NULL condition for uploads
        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        assert "IS NULL" in query_str

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_mixed_feed_ids_and_uploads(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["feed-1", "__uploads__"])

        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        params = call_args[0][1]
        assert "IS NULL" in query_str
        assert params["fid_0"] == "feed-1"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_episode_id_filter(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", episode_id="ep-42")

        call_args = mock_db.execute.call_args
        query_str = str(call_args[0][0])
        params = call_args[0][1]
        assert "episode_id" in query_str
        assert params["episode_id"] == "ep-42"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_episode_scoped_skips_similarity_threshold(self, mock_embed):
        """Generic questions scoped to one episode must return chunks even
        when every candidate's similarity is below SIMILARITY_THRESHOLD."""
        low_row = MagicMock()
        low_row.chunk_id = 1
        low_row.episode_id = "ep-42"
        low_row.episode_title = "Scoped"
        low_row.speaker_label = None
        low_row.start_time = 0.0
        low_row.end_time = 5.0
        low_row.text = "Below-threshold but still relevant within episode"
        low_row.similarity = 0.1  # Below SIMILARITY_THRESHOLD (0.3)

        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [low_row]

        from app.services.rag import retrieve_chunks
        results = retrieve_chunks(mock_db, "what is this about?", episode_id="ep-42")
        assert len(results) == 1
        assert results[0].similarity == 0.1


class TestSpeakerAwareRetrieval:
    """#696: scope retrieval to a speaker across every feed and episode.

    Chunk embeddings carry no speaker signal (chunking.py builds them from
    segment text alone), so "what did X say about Y" previously retrieved
    whatever was most similar to Y regardless of who said it. The LLM then
    labelled those chunks with the right speaker while potentially
    attributing the wrong words.
    """

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_filters_on_the_resolved_name_not_the_raw_label(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", speaker_display="Jacob Shapiro")

        query_str = str(mock_db.execute.call_args[0][0])
        params = mock_db.execute.call_args[0][1]

        # The filter must use the same three-level fallback as the SELECT, or
        # it can disagree with the name shown to the user.
        assert "COALESCE(sn.display_name, fsc.display_name, c.speaker_label)" in query_str
        assert params["speaker_display"] == "Jacob Shapiro"

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_does_not_compare_the_raw_diarization_label(self, mock_embed):
        # The old filter was `c.speaker_label = :speaker_label`, which only
        # means anything inside one episode -- the same person is SPEAKER_00
        # in one and SPEAKER_03 in the next. Guard against a revert.
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", speaker_display="Jacob Shapiro")

        query_str = str(mock_db.execute.call_args[0][0])
        assert "AND c.speaker_label = :" not in query_str

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_no_speaker_filter_when_none_given(self, mock_embed):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q")

        params = mock_db.execute.call_args[0][1]
        assert "speaker_display" not in params

    @patch("app.services.rag.embed_query", return_value=[0.1, 0.2, 0.3])
    def test_combines_with_feed_scope(self, mock_embed):
        # Speaker and feed filters are independent; asking about one person
        # within a subset of feeds must apply both.
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = []

        from app.services.rag import retrieve_chunks
        retrieve_chunks(mock_db, "q", feed_ids=["feed-1"], speaker_display="Marko Papic")

        query_str = str(mock_db.execute.call_args[0][0])
        params = mock_db.execute.call_args[0][1]
        assert "e.feed_id IN" in query_str
        assert "COALESCE(sn.display_name" in query_str
        assert params["fid_0"] == "feed-1"
        assert params["speaker_display"] == "Marko Papic"
