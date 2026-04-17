"""
Single source of truth for task and periodic task handler registration.

Each entry maps a task name to its dotted import path. Handlers are lazily
resolved at dispatch time to avoid importing heavy modules (whisper, pyannote)
at worker startup.
"""
import importlib
from typing import Callable

from app.config import settings


def _resolve(dotted_path: str) -> Callable:
    module_path, func_name = dotted_path.rsplit(":", 1)
    mod = importlib.import_module(module_path)
    return getattr(mod, func_name)


def _lazy_handler(dotted_path: str) -> Callable[[str], None]:
    def handler(episode_id: str) -> None:
        _resolve(dotted_path)(episode_id)
    return handler


TASK_REGISTRY: dict[str, str] = {
    "download": "app.tasks.download:download_episode",
    "transcribe": "app.tasks.transcribe:transcribe_episode",
    "diarize": "app.tasks.diarize:diarize_episode",
    "chunk": "app.tasks.chunk:chunk_episode",
    "embed": "app.tasks.embed:embed_episode",
    "infer": "app.tasks.infer:infer_speakers",
    "archive": "app.tasks.archive:archive_episode",
}

TASK_HANDLERS: dict[str, Callable[[str], None]] = {
    name: _lazy_handler(path) for name, path in TASK_REGISTRY.items()
}


class PeriodicTask:
    __slots__ = ("name", "target", "interval_seconds")

    def __init__(self, name: str, target: str, interval_seconds: int | None):
        self.name = name
        self.target = target
        self.interval_seconds = interval_seconds

    def get_interval(self) -> int:
        if self.interval_seconds is not None:
            return self.interval_seconds
        return settings.feed_poll_interval_hours * 3600

    def run(self) -> None:
        _resolve(self.target)()


PERIODIC_TASKS: list[PeriodicTask] = [
    PeriodicTask("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None),
    PeriodicTask("cleanup_zombie_jobs", "app.tasks.cleanup:cleanup_zombie_jobs", 30 * 60),
    PeriodicTask("send_digest", "app.services.digest:send_digest_if_due", 15 * 60),
]


def validate_wiring() -> None:
    """Validate all task and periodic handler references resolve at startup."""
    errors: list[str] = []

    for name, path in TASK_REGISTRY.items():
        try:
            resolved = _resolve(path)
            if not callable(resolved):
                raise TypeError("resolved object is not callable")
        except Exception as exc:
            errors.append(f'TASK_REGISTRY["{name}"]: {type(exc).__name__}: {exc}')

    for task in PERIODIC_TASKS:
        try:
            resolved = _resolve(task.target)
            if not callable(resolved):
                raise TypeError("resolved object is not callable")
        except Exception as exc:
            errors.append(f'PERIODIC_TASKS["{task.name}"]: {type(exc).__name__}: {exc}')

    if errors:
        raise RuntimeError(f"Invalid worker registry wiring: {'; '.join(errors)}")
