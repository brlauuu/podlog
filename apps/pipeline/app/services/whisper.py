"""
Whisper speech-to-text service — PRD-01 §5.4

Uses openai/whisper-large-v3 via HuggingFace transformers.

CRITICAL: The caller (transcribe.py) is responsible for calling unload_model()
after transcription. Whisper and pyannote must never be in memory simultaneously.
"""
import gc
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Module-level model cache — explicitly set to None by unload_model()
_model = None
_processor = None


def load_model(model_name: str = "large-v3"):
    """Load Whisper model into module-level cache. No-op if already loaded."""
    global _model, _processor

    if _model is not None:
        return

    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    import torch

    hf_model_id = f"openai/whisper-{model_name}"
    logger.info('"action": "whisper_load_start", "model": "%s"', hf_model_id)

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device = "cuda" if torch.cuda.is_available() else "cpu"

    _processor = AutoProcessor.from_pretrained(hf_model_id)
    _model = AutoModelForSpeechSeq2Seq.from_pretrained(
        hf_model_id,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    ).to(device)

    logger.info('"action": "whisper_load_complete", "model": "%s", "device": "%s"', hf_model_id, device)


def unload_model() -> None:
    """Explicitly remove Whisper from memory. Must be called before loading pyannote."""
    global _model, _processor
    _model = None
    _processor = None
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    gc.collect()
    logger.info('"action": "whisper_unloaded"')


def transcribe(audio_path: str, model_name: str = "large-v3") -> tuple[list[dict], str]:
    """
    Transcribe audio file. Returns (segments, language).

    segments: list of {"start": float, "end": float, "text": str}
    language: detected language code (e.g. "en")
    """
    from transformers import pipeline as hf_pipeline
    import torch

    load_model(model_name)

    hf_model_id = f"openai/whisper-{model_name}"
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device = "cuda:0" if torch.cuda.is_available() else "cpu"

    pipe = hf_pipeline(
        "automatic-speech-recognition",
        model=_model,
        tokenizer=_processor.tokenizer,
        feature_extractor=_processor.feature_extractor,
        torch_dtype=dtype,
        device=device,
    )

    result = pipe(
        audio_path,
        return_timestamps=True,
        generate_kwargs={"language": None},  # Auto-detect language
    )

    language = result.get("language", "unknown") or "unknown"
    chunks = result.get("chunks", [])

    segments = []
    for chunk in chunks:
        ts = chunk.get("timestamp", (0.0, 0.0))
        start = ts[0] if ts[0] is not None else 0.0
        end = ts[1] if ts[1] is not None else start
        segments.append({"start": start, "end": end, "text": chunk["text"]})

    logger.info(
        '"action": "whisper_transcribe_complete", "segments": %d, "language": "%s"',
        len(segments),
        language,
    )
    return segments, language
