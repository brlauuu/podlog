from celery import Celery

from app.config import settings

celery_app = Celery(
    "podlog",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.tasks.ingest",
        "app.tasks.download",
        "app.tasks.transcribe",
        "app.tasks.diarize",
        "app.tasks.archive",
        "app.tasks.infer",
        "app.tasks.cleanup",
        "app.scheduler",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    worker_concurrency=settings.celery_concurrency,
    # Keep results for 7 days so the UI can poll task state
    result_expires=604800,
    # Store custom state metadata (stage, progress, retry_count)
    task_track_started=True,
    # Prevent Redis from redelivering long-running tasks (transcription/diarization
    # can take 30-60+ min on CPU). Default visibility_timeout is 1h which causes
    # duplicate task execution and starves downstream tasks like diarization.
    broker_transport_options={"visibility_timeout": 7200},  # 2 hours
    # Only prefetch one task at a time — with concurrency=1, prefetched messages
    # would sit idle and hit the visibility timeout, triggering redelivery.
    worker_prefetch_multiplier=1,
    # --- Task routing: heavy vs light worker queues ---
    task_default_queue="light",
    task_routes={
        "transcribe_episode": {"queue": "heavy"},
        "diarize_episode": {"queue": "heavy"},
        "infer_speakers": {"queue": "light"},
        "download_episode": {"queue": "light"},
        "archive_episode": {"queue": "light"},
        "ingest_episode": {"queue": "light"},
        "ingest_feed": {"queue": "light"},
        "cleanup_zombie_jobs": {"queue": "light"},
        "poll_all_feeds": {"queue": "light"},
    },
)
