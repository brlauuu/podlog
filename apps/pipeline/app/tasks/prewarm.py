"""
Model pre-warm -- PRD-01 S5.11

Run before the worker starts accepting jobs. Downloads and caches
Whisper + pyannote model weights (~3 GB on first run).

Sets a DB flag (system_state table) when complete so the health endpoint
can transition from WARMING_UP -> OK.

Usage (from docker-compose.yml):
  python -m app.tasks.prewarm
"""
import gc
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _is_prewarm_done() -> bool:
    """Check if prewarm has already completed (via DB flag)."""
    try:
        from app.database import SessionLocal
        from app.models import SystemState
        db = SessionLocal()
        try:
            row = db.query(SystemState).filter(SystemState.key == "prewarm_done").first()
            return row is not None and row.value == "1"
        finally:
            db.close()
    except Exception:
        return False


def _set_prewarm_done() -> None:
    """Write prewarm completion flag to DB (visible to all containers)."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.database import SessionLocal
    from app.models import SystemState
    db = SessionLocal()
    try:
        stmt = pg_insert(SystemState.__table__).values(key="prewarm_done", value="1")
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value": "1"})
        db.execute(stmt)
        db.commit()
    finally:
        db.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    from app.config import settings

    if settings.inference_provider == "fireworks":
        logger.info('"action": "prewarm_skipped", "reason": "fireworks_provider"')
        _set_prewarm_done()
        return

    # Check if models are already cached
    whisper_cache = Path(settings.model_cache_dir) / "hub"
    if whisper_cache.exists() and _is_prewarm_done():
        logger.info('"action": "prewarm_skipped", "reason": "models_already_cached"')
        return

    logger.info('"action": "prewarm_start", "whisper_model": "%s"', settings.whisper_model)

    # Download Whisper (WhisperX + CTranslate2 model)
    try:
        from app.services.whisper import load_model, unload_model
        logger.info('"action": "prewarm_whisper_download"')
        load_model(settings.whisper_model)
        unload_model()
        logger.info('"action": "prewarm_whisper_done"')
    except Exception as exc:
        logger.error('"action": "prewarm_whisper_failed", "error": "%s"', exc)
        sys.exit(1)

    # Download wav2vec2 alignment model -- failure is non-fatal
    try:
        import whisperx
        device = "cpu"
        logger.info('"action": "prewarm_align_model_download"')
        model_a, metadata = whisperx.load_align_model(language_code="en", device=device)
        del model_a, metadata
        gc.collect()
        logger.info('"action": "prewarm_align_model_done"')
    except Exception as exc:
        logger.warning('"action": "prewarm_align_model_failed", "error": "%s"', exc)

    # Download pyannote -- failure is non-fatal (per PRD-01 S5.4)
    try:
        from app.services.pyannote import load_pipeline, unload_pipeline
        logger.info('"action": "prewarm_pyannote_download"')
        load_pipeline()
        unload_pipeline()
        logger.info('"action": "prewarm_pyannote_done"')
    except Exception as exc:
        logger.warning('"action": "prewarm_pyannote_failed", "error": "%s"', exc)

    _set_prewarm_done()
    logger.info('"action": "prewarm_complete"')


if __name__ == "__main__":
    main()
