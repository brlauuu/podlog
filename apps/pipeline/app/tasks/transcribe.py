"""
Transcription task -- PRD-01 S5.3, S5.4, Issue #222

- Local provider path:
  - Converts audio to 16kHz mono WAV (ffmpeg)
  - Transcribes with Whisper model from config
  - Explicitly unloads Whisper before returning
- Fireworks provider path:
  - Sends source audio directly to Fireworks transcription API
- Both paths persist segments and queue diarization.

Failures (FireworksTranscriptionError, MemoryError, network errors, etc.)
propagate to the worker loop, which classifies and decides retry vs
terminal (#641 / #653).
"""
import gc
import logging
import time
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Segment
from app.services.notification_settings import get_runtime_inference_settings
from app.tasks.helpers import update_episode
from app.tasks.transcribe_helpers import (
    compute_fireworks_cost,
    estimate_fireworks_usage,
    persist_transcription_artifacts,
    remove_artifacts,
)
from app import job_queue

logger = logging.getLogger(__name__)


def _load_fireworks_service():
    """Import Fireworks service lazily so local mode has no dependency edge."""
    from app.services import fireworks_audio

    return fireworks_audio


def transcribe_episode(episode_id: str) -> str:
    db = SessionLocal()
    queued_next = False
    alignment_path = Path(settings.transcript_dir) / f"{episode_id}.whisperx.json"
    fireworks_path = Path(settings.transcript_dir) / f"{episode_id}.fireworks.json"
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode or not episode.audio_local_path:
            raise RuntimeError(f"Episode {episode_id} not found or missing audio path")

        # Idempotency guard: skip if already transcribed (redelivered message)
        if episode.status in ("diarizing", "inferring", "archiving", "done"):
            logger.info(
                '"action": "transcribe_skip_already_done", "episode_id": "%s", "status": "%s"',
                episode_id, episode.status,
            )
            return episode_id

        update_episode(db, episode_id, status="transcribing")

        audio_path = Path(episode.audio_local_path)
        transcribe_secs = 0.0
        segments_data: list[dict] = []
        language = "unknown"
        aligned_result: dict | None = None
        fireworks_result: dict | None = None

        # Defensive cleanup of stale artifacts from previous failed attempts.
        remove_artifacts(alignment_path, fireworks_path)

        runtime = get_runtime_inference_settings(db)
        provider = runtime.get("inference_provider") or "local"
        update_episode(db, episode_id, inference_provider_used=provider)
        if provider == "fireworks":
            fireworks_audio = _load_fireworks_service()

            api_key = runtime.get("fireworks_api_key")
            if not api_key:
                raise RuntimeError(
                    "Fireworks inference provider selected but FIREWORKS_API_KEY is missing"
                )
            audio_file_size_bytes = audio_path.stat().st_size if audio_path.exists() else None
            update_episode(db, episode_id, audio_file_size_bytes=audio_file_size_bytes)
            t0 = time.monotonic()
            # FireworksTranscriptionError carries retryable + error_class metadata;
            # the worker's _classify_for_retry reads those, so we just let it propagate.
            segments_data, language, fireworks_result = fireworks_audio.transcribe(
                str(audio_path),
                api_key=api_key,
                audio_base_url=runtime.get("fireworks_audio_base_url")
                or settings.fireworks_audio_base_url,
                model_name=runtime.get("fireworks_stt_model") or settings.fireworks_stt_model,
                diarize=bool(runtime.get("fireworks_stt_diarize", True)),
            )
            transcribe_secs = round(time.monotonic() - t0, 1)
            audio_secs = estimate_fireworks_usage(segments_data, episode.duration_secs)
            runtime_rate = runtime.get("fireworks_stt_cost_per_minute_usd")
            configured_rate = (
                runtime_rate
                if runtime_rate is not None
                else settings.fireworks_stt_cost_per_minute_usd
            )
            stt_rate = float(configured_rate if configured_rate is not None else 0.0)
            audio_minutes, stt_cost_usd = compute_fireworks_cost(audio_secs, stt_rate)

            update_episode(
                db,
                episode_id,
                transcribe_duration_secs=transcribe_secs,
                fireworks_audio_secs=round(audio_secs, 1),
                fireworks_audio_minutes=audio_minutes,
                fireworks_stt_cost_per_minute_usd=stt_rate,
                fireworks_stt_cost_usd=stt_cost_usd,
            )
            logger.info(
                '"action": "fireworks_transcribe_observability", "episode_id": "%s", '
                '"audio_secs": %.1f, "audio_minutes": %.3f, "stt_rate_usd_per_min": %.6f, '
                '"stt_cost_usd": %.4f',
                episode_id,
                audio_secs,
                audio_minutes,
                stt_rate,
                stt_cost_usd,
            )
        else:
            # Step 1: convert to 16kHz mono WAV. ffmpeg failures propagate
            # to the worker as SYSTEM_ERROR (#653).
            wav_path = audio_path.with_suffix(".wav")
            _convert_to_wav(audio_path, wav_path)

            # Step 2: transcribe (local WhisperX). MemoryError → OOM
            # is classified by the worker. Whisper is ALWAYS unloaded
            # afterwards via the finally clause (PRD-01 S5.4).
            try:
                from app.services.whisper import transcribe

                t0 = time.monotonic()
                segments_data, language, aligned_result = transcribe(
                    str(wav_path), model_name=settings.whisper_model
                )
                transcribe_secs = round(time.monotonic() - t0, 1)
                update_episode(
                    db,
                    episode_id,
                    transcribe_duration_secs=transcribe_secs,
                    fireworks_audio_secs=None,
                    fireworks_audio_minutes=None,
                    fireworks_stt_cost_per_minute_usd=None,
                    fireworks_stt_cost_usd=None,
                )
            finally:
                # MANDATORY: unload Whisper before pyannote can be loaded (PRD-01 S5.4)
                _unload_whisper()
                if wav_path.exists():
                    update_episode(db, episode_id, audio_file_size_bytes=wav_path.stat().st_size)
                    wav_path.unlink()

        # Step 2b: save alignment/transcript data for diarization
        try:
            out_dir = Path(settings.transcript_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
            if aligned_result is not None or fireworks_result is not None:
                persist_transcription_artifacts(
                    settings.transcript_dir,
                    episode_id,
                    aligned_result=aligned_result,
                    fireworks_result=fireworks_result,
                )
        except Exception as exc:
            logger.warning(
                '"action": "alignment_save_failed", "episode_id": "%s", "error": "%s"',
                episode_id, exc,
            )

        # Step 3: persist segments
        db.query(Segment).filter(Segment.episode_id == episode_id).delete()
        for seg in segments_data:
            db.add(
                Segment(
                    episode_id=episode_id,
                    start_time=seg["start"],
                    end_time=seg["end"],
                    text=seg["text"].strip(),
                    speaker_label=None,  # Assigned in diarize step
                )
            )

        update_episode(db, episode_id, language=language, status="diarizing")

        logger.info(
            '"action": "transcribe_complete", "episode_id": "%s", "segments": %d, "language": "%s", "duration_secs": %.1f',
            episode_id,
            len(segments_data),
            language,
            transcribe_secs,
        )

        job_queue.enqueue(db, episode_id, "diarize")
        queued_next = True
        return episode_id
    finally:
        if not queued_next:
            # If we failed before enqueueing diarize, remove intermediate artifacts.
            remove_artifacts(alignment_path, fireworks_path)
        db.close()


def _convert_to_wav(src: Path, dest: Path) -> None:
    import ffmpeg

    ffmpeg.input(str(src)).output(
        str(dest), ar=16000, ac=1, acodec="pcm_s16le"
    ).overwrite_output().run(capture_stdout=True, capture_stderr=True)


def _unload_whisper() -> None:
    """Remove Whisper model from memory. Called before pyannote is loaded."""
    import sys

    whisper_mod = sys.modules.get("app.services.whisper")
    if whisper_mod and hasattr(whisper_mod, "_model"):
        whisper_mod._model = None

    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass

    gc.collect()
    logger.info('"action": "whisper_unloaded"')
