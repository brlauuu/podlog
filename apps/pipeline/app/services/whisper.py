"""
Whisper speech-to-text service — PRD-01 §5.4

Uses WhisperX (CTranslate2 backend + wav2vec2 word-level alignment)
for optimized CPU inference.

CRITICAL: The caller (transcribe.py) is responsible for calling unload_model()
after transcription. Whisper and pyannote must never be in memory simultaneously.
"""
import gc
import logging

logger = logging.getLogger(__name__)

# Module-level model cache — explicitly set to None by unload_model()
_model = None


def load_model(model_name: str = "large-v3-turbo") -> None:
    """Load Whisper model into module-level cache. No-op if already loaded."""
    global _model

    if _model is not None:
        return

    import whisperx
    from app.config import settings

    device = "cuda" if _cuda_available() else "cpu"
    compute_type = settings.whisper_compute_type

    logger.info(
        '"action": "whisper_load_start", "model": "%s", "backend": "whisperx"',
        model_name,
    )

    _model = whisperx.load_model(
        model_name,
        device=device,
        compute_type=compute_type,
    )

    logger.info(
        '"action": "whisper_load_complete", "model": "%s", "device": "%s"',
        model_name, device,
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


def transcribe(audio_path: str, model_name: str = "large-v3-turbo") -> tuple[list[dict], str]:
    """
    Transcribe audio file. Returns (segments, language).

    segments: list of {"start": float, "end": float, "text": str}
    language: detected language code (e.g. "en")
    """
    import whisperx
    from app.config import settings

    load_model(model_name)

    device = "cuda" if _cuda_available() else "cpu"
    audio = whisperx.load_audio(audio_path)

    # Stage 1: Transcribe (batched inference via faster-whisper)
    result = _model.transcribe(audio, batch_size=settings.whisper_batch_size)
    language = result.get("language", "unknown") or "unknown"

    # Stage 2: Word-level alignment (optional but recommended)
    try:
        model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
        result = whisperx.align(result["segments"], model_a, metadata, audio, device)
        del model_a
        gc.collect()
    except Exception as exc:
        logger.warning('"action": "whisper_align_failed", "error": "%s"', exc)
        # Fall back to segment-level timestamps (still usable)

    # Convert to expected output format
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
            "text": seg.get("text", "").strip(),
        })

    logger.info(
        '"action": "whisper_transcribe_complete", "segments": %d, "language": "%s"',
        len(segments), language,
    )
    return segments, language


def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
