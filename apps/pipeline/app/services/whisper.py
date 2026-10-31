"""
Whisper speech-to-text service — PRD-01 §5.4

Transcribes with faster-whisper (CTranslate2) and its batched pipeline, with
word timestamps on for every language (#1093). The word times then come from
one of two places, recorded per episode as ``word_timestamps``:

- ``wav2vec2``: the language has a WhisperX alignment model (English,
  Croatian, ...). The native words are re-aligned with it, as before #1093.
- ``native``: no alignment model (Serbian, ...), or alignment failed. The
  words keep faster-whisper's own times, derived from cross-attention, and
  the 30 s VAD chunks are split into sentences here, since there is no
  aligner to do it.
- ``none``: nothing produced word times. Diarization then assigns one
  speaker per segment.

Before #1093 a language without an aligner silently lost its word times,
which is how 51 Serbian episodes went to segment-level diarization unnoticed.

CRITICAL: The caller (transcribe.py) is responsible for calling unload_model()
after transcription. Whisper and pyannote must never be in memory simultaneously.
"""
import gc
import logging
import os

logger = logging.getLogger(__name__)

# Module-level model cache — explicitly set to None by unload_model()
_model = None

# A word ending in one of these closes a sentence in the native fallback.
_SENTENCE_END = (".", "?", "!", "…")
_CLOSING = "\"'”’)]}»"

# Whisper's own "this decode failed" thresholds (the faster-whisper defaults).
_MAX_COMPRESSION_RATIO = 2.4
_MIN_LOG_PROB = -1.0
_SAMPLE_RATE = 16000  # decode_audio's default
_LANGUAGE_WINDOWS = 5
_LANGUAGE_WINDOW_SECS = 30


def _resolve_cpu_threads(configured: int) -> int:
    """Resolve the CTranslate2 CPU thread count for the ASR pass.

    CTranslate2 defaults to 4 threads, which caps transcription at 4 cores
    no matter how large the host is. We instead pass an explicit value:
    a positive ``configured`` wins; 0 means auto-detect available cores.
    """
    if configured > 0:
        return configured
    try:
        return len(os.sched_getaffinity(0))
    except AttributeError:  # not available on all platforms
        return os.cpu_count() or 4


def load_model(model_name: str = "large-v3-turbo") -> None:
    """Load Whisper model into module-level cache. No-op if already loaded."""
    global _model

    if _model is not None:
        return

    from faster_whisper import WhisperModel
    from app.config import settings

    device = "cuda" if _cuda_available() else "cpu"
    compute_type = settings.whisper_compute_type
    cpu_threads = _resolve_cpu_threads(settings.whisper_cpu_threads)

    logger.info(
        '"action": "whisper_load_start", "model": "%s", "backend": "faster-whisper", '
        '"cpu_threads": %d',
        model_name, cpu_threads,
    )

    _model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
    )

    logger.info(
        '"action": "whisper_load_complete", "model": "%s", "device": "%s", '
        '"cpu_threads": %d',
        model_name, device, cpu_threads,
    )


def unload_model() -> None:
    """Explicitly remove Whisper from memory. Must be called before loading pyannote."""
    global _model
    _model = None
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    gc.collect()
    logger.info('"action": "whisper_unloaded"')


def transcribe(audio_path: str, model_name: str = "large-v3-turbo") -> tuple[list[dict], str, dict]:
    """
    Transcribe audio file. Returns (segments, language, aligned_result).

    segments: list of {"start": float, "end": float, "text": str}
    language: detected language code (e.g. "en")
    aligned_result: {"language", "word_timestamps", "segments"}, where each
                    segment has a "words" list of {"word", "start", "end",
                    "score"} when word times exist. This is what is saved as
                    {episode_id}.whisperx.json for diarization.
    """
    from faster_whisper import BatchedInferencePipeline, decode_audio
    from app.config import settings

    load_model(model_name)

    device = "cuda" if _cuda_available() else "cpu"
    audio = decode_audio(audio_path)

    # Stage 1: batched transcription with native word timestamps
    pipeline = BatchedInferencePipeline(_model)
    raw_segments, info = pipeline.transcribe(
        audio, batch_size=settings.whisper_batch_size, word_timestamps=True,
        language=_detect_language(audio),
    )
    language = info.language or "unknown"
    native = _redo_repetitive(list(raw_segments), audio, info.language)

    # Stage 2: wav2vec2 alignment where the language has a model
    aligned_segments, method = _word_timestamps(native, language, audio, device)

    segments = [
        {
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
            "text": seg.get("text", "").strip(),
        }
        for seg in aligned_segments
    ]
    result = {"language": language, "word_timestamps": method, "segments": aligned_segments}

    logger.info(
        '"action": "whisper_transcribe_complete", "segments": %d, "language": "%s", '
        '"word_timestamps": "%s"',
        len(segments), language, method,
    )
    return segments, language, result


def _detect_language(audio) -> str | None:
    """The episode's language, judged from windows spread across all of it.

    faster-whisper judges from the first 30 s, and stops there once it is
    confident. A podcast's first 30 s is often a jingle or an ad: 4a3387d6
    opens with a Serbian sponsor spot (sr, 0.92) before a 40-minute English
    interview (en, 1.00 in every later window), so the whole interview was
    decoded as Serbian or Croatian (#1093). Summing each language's
    probability over the windows lets the bulk of the episode decide.

    None leaves the decision to faster-whisper, as before.
    """
    window = _LANGUAGE_WINDOW_SECS * _SAMPLE_RATE
    last = max(len(audio) - window, 0)
    starts = sorted({last * i // (_LANGUAGE_WINDOWS - 1) for i in range(_LANGUAGE_WINDOWS)})
    totals: dict[str, float] = {}
    try:
        for start in starts:
            _, _, probs = _model.detect_language(audio[start:start + window])
            for lang, prob in probs:
                totals[lang] = totals.get(lang, 0.0) + prob
    except Exception as exc:
        logger.warning('"action": "whisper_language_detect_failed", "error": "%s"', exc)
        return None
    if not totals:
        return None
    language = max(totals, key=totals.get)
    logger.info(
        '"action": "whisper_language_detected", "language": "%s", "share": %.2f, "windows": %d',
        language, totals[language] / len(starts), len(starts),
    )
    return language


def _redo_repetitive(raw_segments: list, audio, language: str | None) -> list[dict]:
    """Re-decode the chunks batched decoding got stuck in a loop on.

    Whisper normally retries a decode at rising temperatures when the output
    is too repetitive (gzip compression ratio above 2.4) or too unlikely
    (average log-probability below -1.0). faster-whisper's batched pipeline
    keeps only the first temperature, so a chunk that loops stays looped:
    "Ja, da je..." 44 times over English speech in a mixed-language interview
    (#1093).

    Here each such chunk is decoded again on its own, greedily. On 4a3387d6
    that alone recovered every looping chunk of real speech, at temperature
    0. The temperature fallback is deliberately not used: the one chunk that
    needed it was music, and sampling turned it into a different
    "Hvala što pratite..." on every run, sometimes one that passed both
    thresholds. A greedy result that still fails them is dropped instead.
    """
    out: list[dict] = []
    redone = dropped = 0
    for seg in raw_segments:
        if seg.compression_ratio <= _MAX_COMPRESSION_RATIO:
            out.append(_native_segment(seg))
            continue
        redone += 1
        clip = audio[int(seg.start * _SAMPLE_RATE):int(seg.end * _SAMPLE_RATE)]
        retry, _ = _model.transcribe(
            clip, language=language, word_timestamps=True, temperature=0.0,
            condition_on_previous_text=False, vad_filter=False,
        )
        for r in retry:
            if r.compression_ratio > _MAX_COMPRESSION_RATIO or r.avg_logprob < _MIN_LOG_PROB:
                dropped += 1
                continue
            out.append(_native_segment(r, offset=float(seg.start)))
    if redone:
        logger.info(
            '"action": "whisper_repetition_redo", "chunks": %d, "dropped_segments": %d',
            redone, dropped,
        )
    return out


def _native_segment(seg, offset: float = 0.0) -> dict:
    """faster-whisper Segment -> the WhisperX dict shape diarization reads.

    The batched pipeline returns numpy floats, which psycopg2 writes into SQL
    as the literal ``np.float64(28.26)``; the segment insert then fails with
    'schema "np" does not exist'. Hence the float() casts. ``offset`` places a
    segment decoded from a clip back on the episode's timeline.
    """
    return {
        "start": offset + float(seg.start),
        "end": offset + float(seg.end),
        "text": seg.text,
        "words": [
            {
                "word": w.word.strip(),
                "start": offset + float(w.start),
                "end": offset + float(w.end),
                "score": float(w.probability),
            }
            for w in (seg.words or [])
            if w.word.strip()
        ],
    }


def _word_timestamps(
    native: list[dict], language: str, audio, device: str
) -> tuple[list[dict], str]:
    """Pick the word-time source: wav2vec2 if it works, else native, else none."""
    if not native:
        return [], "none"

    import whisperx

    try:
        model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
    except ValueError as exc:
        # WhisperX has no alignment model for this language: expected, not a fault.
        logger.info(
            '"action": "whisper_align_unavailable", "language": "%s", "error": "%s"',
            language, exc,
        )
    except Exception as exc:
        logger.warning(
            '"action": "whisper_align_failed", "language": "%s", "error": "%s"', language, exc,
        )
    else:
        try:
            plain = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in native]
            aligned = whisperx.align(plain, model_a, metadata, audio, device)["segments"]
            if any(seg.get("words") for seg in aligned):
                return aligned, "wav2vec2"
            logger.warning(
                '"action": "whisper_align_no_words", "language": "%s"', language,
            )
        except Exception as exc:
            logger.warning(
                '"action": "whisper_align_failed", "language": "%s", "error": "%s"',
                language, exc,
            )
        finally:
            del model_a, metadata
            gc.collect()

    split = split_sentences(native)
    method = "native" if any(seg.get("words") for seg in split) else "none"
    if method == "none":
        logger.warning('"action": "whisper_no_word_timestamps", "language": "%s"', language)
    return split, method


def _ends_sentence(word: str) -> bool:
    return word.rstrip(_CLOSING).endswith(_SENTENCE_END)


def split_sentences(segments: list[dict]) -> list[dict]:
    """Split VAD-chunk segments into sentences at sentence-ending words.

    Batched faster-whisper returns ~30 s chunks; WhisperX's aligner used to
    split them into sentences, so without it a search hit or a playback jump
    would land up to 30 s off. A segment without words is kept as it is.
    """
    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        if not words:
            out.append(seg)
            continue
        current: list[dict] = []
        for i, word in enumerate(words):
            current.append(word)
            if _ends_sentence(word["word"]) or i == len(words) - 1:
                out.append({
                    "start": current[0]["start"],
                    "end": current[-1]["end"],
                    "text": " ".join(w["word"] for w in current),
                    "words": current,
                })
                current = []
    return out


def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
