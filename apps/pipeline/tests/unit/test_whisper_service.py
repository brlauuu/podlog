"""Unit tests for the faster-whisper-based whisper service (#1093)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


def _word(word, start, end, probability=0.9):
    return SimpleNamespace(word=word, start=start, end=end, probability=probability)


def _segment(start, end, text, words=(), compression_ratio=1.5, avg_logprob=-0.3):
    return SimpleNamespace(
        start=start, end=end, text=text, words=list(words),
        compression_ratio=compression_ratio, avg_logprob=avg_logprob,
    )


# One 6 s VAD chunk holding two sentences, as batched faster-whisper returns it.
CHUNK = _segment(0.0, 6.0, " Hello world. How are you?", [
    _word(" Hello", 0.0, 0.5),
    _word(" world.", 0.5, 1.0),
    _word(" How", 3.0, 3.4),
    _word(" are", 3.4, 3.7),
    _word(" you?", 3.7, 4.2),
])


class TestLoadModel:
    def setup_method(self):
        import app.services.whisper as ws
        ws._model = None

    def test_load_model_creates_faster_whisper_model(self):
        """load_model() creates a faster-whisper model with correct args."""
        mock_model = MagicMock()
        with patch("app.services.whisper._cuda_available", return_value=False), \
             patch("app.services.whisper._resolve_cpu_threads", return_value=8), \
             patch("faster_whisper.WhisperModel", return_value=mock_model) as mock_cls:
            import app.services.whisper as ws
            ws.load_model("large-v3-turbo")
            mock_cls.assert_called_once_with(
                "large-v3-turbo", device="cpu", compute_type="int8", cpu_threads=8,
            )
            assert ws._model is mock_model

    def test_load_model_noop_if_cached(self):
        """load_model() is a no-op when model is already loaded."""
        with patch("faster_whisper.WhisperModel") as mock_cls:
            import app.services.whisper as ws
            ws._model = MagicMock()  # already loaded
            ws.load_model("large-v3-turbo")
            mock_cls.assert_not_called()


class TestResolveCpuThreads:
    def test_positive_configured_value_wins(self):
        """A positive configured value is used verbatim."""
        import app.services.whisper as ws
        assert ws._resolve_cpu_threads(8) == 8

    def test_zero_auto_detects_available_cores(self):
        """0 auto-detects via sched_getaffinity."""
        import app.services.whisper as ws
        with patch("os.sched_getaffinity", return_value={0, 1, 2, 3}):
            assert ws._resolve_cpu_threads(0) == 4

    def test_zero_falls_back_to_cpu_count_without_affinity(self):
        """Falls back to os.cpu_count() when sched_getaffinity is absent."""
        import app.services.whisper as ws
        with patch("os.sched_getaffinity", side_effect=AttributeError), \
             patch("os.cpu_count", return_value=6):
            assert ws._resolve_cpu_threads(0) == 6


class TestUnloadModel:
    def test_unload_clears_model(self):
        """unload_model() sets _model to None and calls gc.collect()."""
        import app.services.whisper as ws
        ws._model = MagicMock()
        ws.unload_model()
        assert ws._model is None

# Stands in for decoded audio: sample index i holds i, so a clip shows its bounds.
AUDIO = list(range(16000 * 60))


@pytest.fixture
def run(monkeypatch):
    """Call transcribe() with faster-whisper returning `segments` in `language`."""
    import app.services.whisper as ws

    def _run(segments, language="en", align_model=None, align=None, batch_size=16, retry=(),
             audio=AUDIO, detect=None):
        pipeline = MagicMock()
        pipeline.transcribe.return_value = (iter(segments), SimpleNamespace(language=language))
        ws._model = MagicMock()
        ws._model.transcribe.return_value = (iter(retry), SimpleNamespace(language=language))
        ws._model.detect_language.configure_mock(
            **(detect or {"return_value": (language, 1.0, [(language, 1.0)])})
        )
        with patch("app.services.whisper.load_model"), \
             patch("app.services.whisper._cuda_available", return_value=False), \
             patch("faster_whisper.decode_audio", return_value=audio), \
             patch("faster_whisper.BatchedInferencePipeline", return_value=pipeline), \
             patch("whisperx.load_align_model", **(align_model or {})) as load_align, \
             patch("whisperx.align", **(align or {})) as do_align, \
             patch("app.config.settings") as mock_settings:
            mock_settings.whisper_batch_size = batch_size
            out = ws.transcribe("/tmp/test.wav")
        return out, pipeline, load_align, do_align, ws._model

    return _run


class TestTranscribe:
    def test_word_timestamps_always_requested(self, run):
        """Native word times are asked for on every run, with the configured batch size."""
        _, pipeline, _, _, _ = run([], batch_size=8)
        kwargs = pipeline.transcribe.call_args.kwargs
        assert kwargs["word_timestamps"] is True
        assert kwargs["batch_size"] == 8

    def test_language_with_aligner_uses_wav2vec2(self, run):
        """English: native segments are re-aligned with wav2vec2, without their words."""
        aligned = [
            {"start": 0.0, "end": 1.0, "text": " Hello world.",
             "words": [{"word": "Hello", "start": 0.0, "end": 0.5, "score": 0.8},
                       {"word": "world.", "start": 0.5, "end": 1.0, "score": 0.8}]},
            {"start": 3.0, "end": 4.2, "text": " How are you?",
             "words": [{"word": "How", "start": 3.0, "end": 3.4, "score": 0.8}]},
        ]
        (segments, language, result), _, load_align, do_align, _ = run(
            [CHUNK],
            align_model={"return_value": ("model_a", "meta")},
            align={"return_value": {"segments": aligned}},
        )
        load_align.assert_called_once_with(language_code="en", device="cpu")
        passed = do_align.call_args.args[0]
        assert passed == [{"start": 0.0, "end": 6.0, "text": " Hello world. How are you?"}]
        assert language == "en"
        assert result["word_timestamps"] == "wav2vec2"
        assert result["segments"] is aligned
        assert segments == [
            {"start": 0.0, "end": 1.0, "text": "Hello world."},
            {"start": 3.0, "end": 4.2, "text": "How are you?"},
        ]

    def test_language_without_aligner_keeps_native_words(self, run):
        """Serbian: no aligner, so native words are kept and the chunk is split."""
        (segments, language, result), _, _, do_align, _ = run(
            [CHUNK], language="sr",
            align_model={"side_effect": ValueError("No default align-model for language: sr")},
        )
        do_align.assert_not_called()
        assert language == "sr"
        assert result["word_timestamps"] == "native"
        assert segments == [
            {"start": 0.0, "end": 1.0, "text": "Hello world."},
            {"start": 3.0, "end": 4.2, "text": "How are you?"},
        ]
        # The shape _diarize_wordlevel reads: segments[].words[] with word/start/end.
        assert result["segments"][0]["words"] == [
            {"word": "Hello", "start": 0.0, "end": 0.5, "score": 0.9},
            {"word": "world.", "start": 0.5, "end": 1.0, "score": 0.9},
        ]

    def test_native_times_are_python_floats(self, run):
        """Batched faster-whisper returns numpy floats; psycopg2 writes those into SQL
        as ``np.float64(...)`` and the segment insert fails (schema "np")."""
        np = pytest.importorskip("numpy")
        f = np.float64
        chunk = _segment(f(0.0), f(6.0), " Hello world. How are you?", [
            _word(" Hello", f(0.0), f(0.5), f(0.9)),
            _word(" world.", f(0.5), f(1.0), f(0.9)),
            _word(" How", f(3.0), f(3.4), f(0.9)),
            _word(" you?", f(3.4), f(4.2), f(0.9)),
        ])
        (segments, _, result), _, _, _, _ = run(
            [chunk], language="sr", align_model={"side_effect": ValueError("no model")},
        )
        values = [v for s in segments for v in (s["start"], s["end"])]
        for seg in result["segments"]:
            values += [seg["start"], seg["end"]]
            values += [w[k] for w in seg["words"] for k in ("start", "end", "score")]
        assert values and all(type(v) is float for v in values)

    def test_alignment_failure_falls_back_to_native(self, run):
        """An aligner that exists but breaks still leaves the native words."""
        (_, _, result), _, _, _, _ = run(
            [CHUNK],
            align_model={"return_value": ("model_a", "meta")},
            align={"side_effect": RuntimeError("boom")},
        )
        assert result["word_timestamps"] == "native"
        assert len(result["segments"]) == 2

    def test_aligner_load_failure_falls_back_to_native(self, run):
        """A download error loading the aligner is not fatal either."""
        (_, _, result), _, _, _, _ = run(
            [CHUNK], align_model={"side_effect": OSError("connection reset")},
        )
        assert result["word_timestamps"] == "native"

    def test_alignment_without_words_falls_back_to_native(self, run):
        """wav2vec2 returning no word times is not taken as success."""
        (_, _, result), _, _, _, _ = run(
            [CHUNK],
            align_model={"return_value": ("model_a", "meta")},
            align={"return_value": {"segments": [{"start": 0.0, "end": 6.0, "text": "x"}]}},
        )
        assert result["word_timestamps"] == "native"

    def test_no_words_anywhere_is_recorded_as_none(self, run):
        """Nothing produced word times: recorded as none, segments kept as they are."""
        bare = _segment(0.0, 6.0, " Hello world.")
        (segments, _, result), _, _, _, _ = run(
            [bare], language="sr", align_model={"side_effect": ValueError("no model")},
        )
        assert result["word_timestamps"] == "none"
        assert segments == [{"start": 0.0, "end": 6.0, "text": "Hello world."}]

    def test_no_speech_returns_empty(self, run):
        """#955: no segments means an empty result, and no aligner is loaded."""
        (segments, language, result), _, load_align, _, _ = run([], language=None)
        assert segments == []
        assert language == "unknown"
        assert result["word_timestamps"] == "none"
        load_align.assert_not_called()


class TestSplitSentences:
    def test_splits_at_sentence_end_and_keeps_tail(self):
        import app.services.whisper as ws
        seg = {"start": 0.0, "end": 9.0, "text": "", "words": [
            {"word": "One.", "start": 0.0, "end": 0.5},
            {"word": "Two", "start": 1.0, "end": 1.5},
            {"word": "three", "start": 1.5, "end": 2.0},
        ]}
        out = ws.split_sentences([seg])
        assert [(s["start"], s["end"], s["text"]) for s in out] == [
            (0.0, 0.5, "One."), (1.0, 2.0, "Two three"),
        ]

    @pytest.mark.parametrize("word", ["kraj?", "kraj!", "kraj…", 'kraj."', "kraj.)", "kraj.»"])
    def test_sentence_end_variants(self, word):
        import app.services.whisper as ws
        assert ws._ends_sentence(word)

    @pytest.mark.parametrize("word", ["kraj,", "kraj", "dr", "3.5x"])
    def test_not_sentence_end(self, word):
        import app.services.whisper as ws
        assert not ws._ends_sentence(word)


class TestRepetitionRedo:
    """Batched faster-whisper has no temperature fallback, so a chunk that loops
    stays looped. Such chunks are decoded again on their own (#1093)."""

    LOOP = _segment(10.0, 20.0, " Ja, da je..." * 44, [_word(" Ja,", 10.0, 10.2)],
                    compression_ratio=11.3)

    def _run_sr(self, run, segments, retry):
        return run(segments, language="sr",
                   align_model={"side_effect": ValueError("no model")}, retry=retry)

    def test_ordinary_chunks_are_not_redone(self, run):
        _, _, _, _, model = self._run_sr(run, [CHUNK], retry=())
        model.transcribe.assert_not_called()

    def test_looping_chunk_is_redone_greedily_and_placed_on_the_timeline(self, run):
        fixed = _segment(0.5, 2.0, " It takes two hours.", [
            _word(" It", 0.5, 0.7), _word(" takes", 0.7, 1.0),
            _word(" two", 1.0, 1.3), _word(" hours.", 1.3, 2.0),
        ])
        (segments, _, result), _, _, _, model = self._run_sr(run, [CHUNK, self.LOOP], [fixed])

        clip = model.transcribe.call_args.args[0]
        assert (clip[0], len(clip)) == (10 * 16000, 10 * 16000)  # exactly 10.0-20.0 s
        kwargs = model.transcribe.call_args.kwargs
        assert kwargs["language"] == "sr"
        assert kwargs["word_timestamps"] is True
        # Greedy only: sampled fallbacks turned music into a fresh hallucination.
        assert kwargs["temperature"] == 0.0
        assert kwargs["condition_on_previous_text"] is False

        assert all("Ja, da je" not in s["text"] for s in segments)
        assert segments[-1] == {"start": 10.5, "end": 12.0, "text": "It takes two hours."}
        assert result["segments"][-1]["words"][0] == {
            "word": "It", "start": 10.5, "end": 10.7, "score": 0.9,
        }

    @pytest.mark.parametrize("bad", [
        {"compression_ratio": 3.1, "avg_logprob": -0.2},   # still a loop
        {"compression_ratio": 0.7, "avg_logprob": -1.06},  # below Whisper's log-prob floor
    ])
    def test_a_redo_that_still_fails_is_dropped(self, run, bad):
        junk = _segment(0.0, 2.8, " Hvala što pratite.", [_word(" Hvala", 0.0, 0.5)], **bad)
        (segments, _, _), _, _, _, _ = self._run_sr(run, [CHUNK, self.LOOP], [junk])
        assert [s["text"] for s in segments] == ["Hello world.", "How are you?"]


class TestLanguageDetection:
    """The language is judged across the whole episode, not its first 30 s,
    which is often a jingle or an ad in another language (#1093)."""

    TEN_MINUTES = list(range(16000 * 600))

    def test_an_intro_in_another_language_does_not_decide(self, run):
        # 4a3387d6: a Serbian sponsor spot, then an English interview.
        windows = [("sr", 0.92, [("sr", 0.92), ("hr", 0.05), ("en", 0.03)])] + \
                  [("en", 1.0, [("en", 1.0)])] * 4
        _, pipeline, _, _, model = run(
            [CHUNK], audio=self.TEN_MINUTES, detect={"side_effect": windows},
        )
        assert pipeline.transcribe.call_args.kwargs["language"] == "en"
        starts = [c.args[0][0] for c in model.detect_language.call_args_list]
        assert starts == [int(t * 16000) for t in (0, 142.5, 285, 427.5, 570)]  # 600 s, last at 570
        assert all(len(c.args[0]) == 30 * 16000 for c in model.detect_language.call_args_list)

    def test_an_ad_in_another_language_does_not_outvote_the_episode(self, run):
        windows = [("sr", 0.95, [("sr", 0.95)])] * 3 + [("en", 1.0, [("en", 1.0)])] + \
                  [("sr", 0.9, [("sr", 0.9), ("hr", 0.1)])]
        _, pipeline, _, _, _ = run(
            [CHUNK], audio=self.TEN_MINUTES, detect={"side_effect": windows},
        )
        assert pipeline.transcribe.call_args.kwargs["language"] == "sr"

    def test_audio_shorter_than_a_window_is_judged_once(self, run):
        _, pipeline, _, _, model = run([CHUNK], language="hr", audio=list(range(16000 * 20)))
        assert model.detect_language.call_count == 1
        assert pipeline.transcribe.call_args.kwargs["language"] == "hr"

    def test_a_failed_detection_leaves_it_to_faster_whisper(self, run):
        _, pipeline, _, _, _ = run([CHUNK], detect={"side_effect": RuntimeError("boom")})
        assert pipeline.transcribe.call_args.kwargs["language"] is None
