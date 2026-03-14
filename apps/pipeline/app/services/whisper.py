"""
Whisper speech-to-text service — PRD-01 §5.4

Uses faster-whisper (CTranslate2 backend) for optimized CPU inference.

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

    from faster_whisper import WhisperModel
    from app.config import settings

    device = "cuda" if _cuda_available() else "cpu"
    compute_type = settings.whisper_compute_type

    logger.info(
        '"action": "whisper_load_start", "model": "%s", "compute_type": "%s"',
        model_name, compute_type,
    )

    _model = WhisperModel(model_name, device=device, compute_type=compute_type)

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
    from app.config import settings

    load_model(model_name)

    # IMPORTANT: model.transcribe() returns a generator — segments are produced
    # lazily as transcription progresses. We must materialize with list().
    result_segments, info = _model.transcribe(
        audio_path,
        beam_size=settings.whisper_beam_size,
        vad_filter=True,       # Skip silence — important for podcasts
    )

    language = info.language if info.language else "unknown"

    segments = []
    for seg in result_segments:
        segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
        })

    logger.info(
        '"action": "whisper_transcribe_complete", "segments": %d, "language": "%s"',
        len(segments),
        language,
    )
    return segments, language


def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
