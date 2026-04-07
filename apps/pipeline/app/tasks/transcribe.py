"""
Transcription task -- PRD-01 S5.3, S5.4

- Converts audio to 16kHz mono WAV (ffmpeg)
- Transcribes with Whisper large-v3 (or configured model)
- Writes segments to database
- EXPLICITLY unloads Whisper from memory before returning
  (mandatory -- Whisper + pyannote must never be resident simultaneously)
"""
import gc
import json
import logging
import time
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Segment
from app.tasks.helpers import mark_failed as _mark_failed, update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def transcribe_episode(episode_id: str) -> str:
    db = SessionLocal()
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

        provider = settings.inference_provider
        if provider == "fireworks":
            try:
                from app.services.fireworks_audio import transcribe as fw_transcribe

                t0 = time.monotonic()
                segments_data, language, fireworks_result = fw_transcribe(
                    str(audio_path),
                    model_name=settings.fireworks_stt_model,
                    diarize=settings.fireworks_stt_diarize,
                )
                transcribe_secs = round(time.monotonic() - t0, 1)
                update_episode(db, episode_id, transcribe_duration_secs=transcribe_secs)
            except Exception as exc:
                _mark_failed(db, episode_id, "SYSTEM_ERROR", str(exc))
                logger.exception('"action": "transcribe_failed", "episode_id": "%s"', episode_id)
                return episode_id
        else:
            # Step 1: convert to 16kHz mono WAV
            wav_path = audio_path.with_suffix(".wav")
            try:
                _convert_to_wav(audio_path, wav_path)
            except Exception as exc:
                _mark_failed(db, episode_id, "SYSTEM_ERROR", f"ffmpeg conversion failed: {exc}")
                return episode_id

            # Step 2: transcribe (local WhisperX)
            try:
                from app.services.whisper import transcribe

                t0 = time.monotonic()
                segments_data, language, aligned_result = transcribe(
                    str(wav_path), model_name=settings.whisper_model
                )
                transcribe_secs = round(time.monotonic() - t0, 1)
                update_episode(db, episode_id, transcribe_duration_secs=transcribe_secs)
            except MemoryError as exc:
                _mark_failed(db, episode_id, "OOM", str(exc))
                return episode_id
            except Exception as exc:
                _mark_failed(db, episode_id, "SYSTEM_ERROR", str(exc))
                logger.exception('"action": "transcribe_failed", "episode_id": "%s"', episode_id)
                return episode_id
            finally:
                # MANDATORY: unload Whisper before pyannote can be loaded (PRD-01 S5.4)
                _unload_whisper()
                if wav_path.exists():
                    wav_path.unlink()

        # Step 2b: save alignment/transcript data for diarization
        try:
            out_dir = Path(settings.transcript_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
            if aligned_result is not None:
                alignment_path = out_dir / f"{episode_id}.whisperx.json"
                with open(alignment_path, "w") as f:
                    json.dump(aligned_result, f)
            if fireworks_result is not None:
                fireworks_path = out_dir / f"{episode_id}.fireworks.json"
                with open(fireworks_path, "w") as f:
                    json.dump(fireworks_result, f)
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
        return episode_id
    finally:
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
