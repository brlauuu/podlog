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
_pipeline_model: Optional[str] = None


def _resolve_model() -> str:
    """Resolve the active pyannote model — runtime DB override beats env default.

    The DB-backed setting is populated by the Settings → Remote Inference UI
    (#681). Falls back to ``settings.pyannote_model`` (env var) when no
    override exists or when the DB session can't be opened.
    """
    from app.config import settings

    try:
        from app.database import SessionLocal
        from app.services.notification_settings import get_runtime_diarization_settings

        with SessionLocal() as db:
            runtime = get_runtime_diarization_settings(db)
        override = runtime.get("pyannote_model")
        if isinstance(override, str) and override.strip():
            return override
    except Exception:
        # Any failure falls back to env default — pipeline boot mustn't depend
        # on the settings table being readable.
        logger.exception('"action": "pyannote_runtime_resolve_failed"')
    return settings.pyannote_model


def load_pipeline():
    """Load pyannote diarization pipeline into module-level cache.

    If the cached pipeline was built for a different model than the one
    currently configured (e.g. user switched in Settings), the old pipeline
    is unloaded first so the new model can take its place.
    """
    global _pipeline, _pipeline_model

    target_model = _resolve_model()
    if _pipeline is not None and _pipeline_model == target_model:
        return
    if _pipeline is not None and _pipeline_model != target_model:
        logger.info(
            '"action": "pyannote_model_switch", "from": "%s", "to": "%s"',
            _pipeline_model, target_model,
        )
        unload_pipeline()

    from pyannote.audio import Pipeline
    from app.config import settings
    import torch

    logger.info('"action": "pyannote_load_start", "model": "%s"', target_model)

    try:
        _pipeline = Pipeline.from_pretrained(
            target_model,
            token=settings.hf_token,
        )
    except Exception as exc:
        if _is_hf_auth_error(exc):
            msg = (
                f"pyannote_auth_failed: cannot load {target_model}. Verify "
                f"(1) HF_TOKEN is set with 'read' scope, "
                f"(2) repo id is correct, "
                f"(3) gate accepted at https://huggingface.co/{target_model}."
            )
            logger.error('"action": "pyannote_auth_failed", "model": "%s"', target_model)
            raise RuntimeError(msg) from exc
        raise

    if torch.cuda.is_available():
        _pipeline = _pipeline.to(torch.device("cuda"))

    _pipeline_model = target_model
    logger.info('"action": "pyannote_load_complete", "model": "%s"', target_model)


def _is_hf_auth_error(exc: BaseException) -> bool:
    """Detect HuggingFace auth / gated-repo / not-found errors from hfhub.

    Covers both typed hfhub errors (RepositoryNotFoundError, GatedRepoError) and
    plain HTTPError with a 401 status — the shape we see when the repo id is a
    typo against a gated namespace (hfhub returns 401 rather than 404).
    """
    try:
        from huggingface_hub.errors import (
            GatedRepoError,
            HfHubHTTPError,
            RepositoryNotFoundError,
        )
    except ImportError:
        return False

    if isinstance(exc, (GatedRepoError, RepositoryNotFoundError)):
        return True
    if isinstance(exc, HfHubHTTPError):
        response = getattr(exc, "response", None)
        return getattr(response, "status_code", None) == 401
    return False


def unload_pipeline() -> None:
    """Explicitly remove pyannote from memory."""
    global _pipeline, _pipeline_model
    _pipeline = None
    _pipeline_model = None
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
    import soundfile as sf
    import torch
    from pathlib import Path

    load_pipeline()

    # Always feed pyannote a preloaded waveform dict so we don't depend on
    # torchaudio's backend dispatcher (which registers nothing by default on
    # torchaudio >=2.8 and is slated for removal in 2.9).
    wav_path, is_temp = _ensure_wav(audio_path)
    try:
        data, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
        # soundfile returns (frames, channels); pyannote expects (channel, time).
        waveform = torch.from_numpy(data.T).contiguous()
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
