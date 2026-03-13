"""
Model pre-warm — PRD-01 §5.11

Run before the Celery worker starts accepting jobs. Downloads and caches
Whisper + pyannote model weights (~3 GB on first run).

Sets a Redis key when complete so the health endpoint can transition from
WARMING_UP → OK.

Usage (from docker-compose.yml):
  python -m app.tasks.prewarm
"""
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PREWARM_DONE_KEY = "podlog:prewarm:done"


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    from app.config import settings
    import redis

    r = redis.from_url(settings.redis_url)

    # Check if models are already cached
    whisper_cache = Path(settings.model_cache_dir) / "hub"
    if whisper_cache.exists() and r.get(PREWARM_DONE_KEY):
        logger.info('"action": "prewarm_skipped", "reason": "models_already_cached"')
        return

    logger.info('"action": "prewarm_start", "whisper_model": "%s"', settings.whisper_model)

    # Download Whisper
    try:
        from app.services.whisper import load_model, unload_model
        logger.info('"action": "prewarm_whisper_download"')
        load_model(settings.whisper_model)
        unload_model()
        logger.info('"action": "prewarm_whisper_done"')
    except Exception as exc:
        logger.error('"action": "prewarm_whisper_failed", "error": "%s"', exc)
        sys.exit(1)

    # Download pyannote — failure is non-fatal (per PRD-01 §5.4)
    try:
        from app.services.pyannote import load_pipeline, unload_pipeline
        logger.info('"action": "prewarm_pyannote_download"')
        load_pipeline()
        unload_pipeline()
        logger.info('"action": "prewarm_pyannote_done"')
    except Exception as exc:
        logger.warning('"action": "prewarm_pyannote_failed", "error": "%s"', exc)

    r.set(PREWARM_DONE_KEY, "1")
    logger.info('"action": "prewarm_complete"')


if __name__ == "__main__":
    main()
