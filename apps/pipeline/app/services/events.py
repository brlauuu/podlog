"""Lightweight in-process event bus."""
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger(__name__)


@dataclass
class Event:
    """Base class for all events."""
    pass


class EventBus:
    """Registry of event type -> handler subscriptions.

    Handlers are called synchronously. A failing handler is logged
    but never propagates — it must not affect the pipeline task.
    """

    def __init__(self) -> None:
        self._handlers: dict[type, list[Callable]] = defaultdict(list)

    def subscribe(self, event_type: type, handler: Callable) -> None:
        self._handlers[event_type].append(handler)

    def emit(self, event: Event) -> None:
        for handler in self._handlers.get(type(event), []):
            try:
                handler(event)
            except Exception:
                logger.exception(
                    '"action": "event_handler_error", "event": "%s", "handler": "%s"',
                    type(event).__name__,
                    getattr(handler, "__name__", repr(handler)),
                )


# Global bus instance — initialized on pipeline startup
bus = EventBus()
