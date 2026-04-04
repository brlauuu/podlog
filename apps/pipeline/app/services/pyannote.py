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


def _ensure_wav(audio_path: str) -> tuple[str, bool]:
    """Convert non-WAV audio to WAV for torchaudio compatibility.

    Returns (path, is_temp) — caller must clean up temp files.
    """
    import subprocess
    from pathlib import Path

    p = Path(audio_path)
    if p.suffix.lower() == ".wav":
        return audio_path, False

    wav_path = p.with_suffix(".diarize.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(p), "-ar", "16000", "-ac", "1", str(wav_path)],
        capture_output=True,
        check=True,
    )
    logger.info('"action": "diarize_convert_wav", "src": "%s", "dst": "%s"', p.name, wav_path.name)
    return str(wav_path), True


def diarize(audio_path: str) -> list[dict]:
    """
    Run speaker diarization. Returns list of:
      {"speaker": "SPEAKER_00", "start": float, "end": float}
    """
    import torchaudio
    from pathlib import Path

    load_pipeline()

    # torchaudio may not have a backend for non-WAV formats (MP3, M4A, etc.)
    # so convert to WAV first using ffmpeg.
    wav_path, is_temp = _ensure_wav(audio_path)
    try:
        waveform, sample_rate = torchaudio.load(wav_path)
    finally:
        if is_temp:
            try:
                Path(wav_path).unlink()
            except OSError:
                pass
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
