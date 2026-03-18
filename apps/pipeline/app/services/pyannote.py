"""
pyannote speaker diarization service — PRD-01 §5.5

IMPORTANT: Only load this after Whisper has been explicitly unloaded.
Whisper + pyannote must never be resident in memory simultaneously.
"""
import gc
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_pipeline = None


def load_pipeline():
    """Load pyannote diarization pipeline into module-level cache."""
    global _pipeline
    if _pipeline is not None:
        return

    from pyannote.audio import Pipeline
    from app.config import settings
    import torch

    logger.info('"action": "pyannote_load_start"')

    _pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=settings.hf_token,
    )

    if torch.cuda.is_available():
        _pipeline = _pipeline.to(torch.device("cuda"))

    logger.info('"action": "pyannote_load_complete"')


def unload_pipeline() -> None:
    """Explicitly remove pyannote from memory."""
    global _pipeline
    _pipeline = None
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    gc.collect()
    logger.info('"action": "pyannote_unloaded"')


def diarize(audio_path: str) -> list[dict]:
    """
    Run speaker diarization. Returns list of:
      {"speaker": "SPEAKER_00", "start": float, "end": float}
    """
    import torchaudio

    load_pipeline()

    # pyannote 4.x requires torchcodec for file-based audio decoding, but
    # torchcodec has PyTorch ABI compat issues in this environment. Instead,
    # load audio via torchaudio and pass the waveform dict directly.
    waveform, sample_rate = torchaudio.load(audio_path)
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}

    result = _pipeline(audio_input)

    # pyannote 4.x returns a DiarizeOutput dataclass; the Annotation with
    # itertracks() lives on .speaker_diarization.  Earlier versions returned
    # the Annotation directly.
    annotation = getattr(result, "speaker_diarization", result)

    if not hasattr(annotation, "itertracks"):
        raise TypeError(
            f"Unexpected pyannote output: {type(result).__name__} has no "
            f"itertracks — check pyannote-audio version compatibility"
        )

    segments = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segments.append(
            {
                "speaker": speaker,
                "start": turn.start,
                "end": turn.end,
            }
        )

    logger.info(
        '"action": "pyannote_diarize_complete", "segments": %d, "speakers": %d',
        len(segments),
        len({s["speaker"] for s in segments}),
    )
    return segments
