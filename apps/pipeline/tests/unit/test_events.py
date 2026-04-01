"""Tests for the in-process event bus."""
from dataclasses import dataclass

from app.services.events import Event, EventBus


@dataclass
class FakeEvent(Event):
    value: str = ""


def test_subscribe_and_emit():
    bus = EventBus()
    received = []
    bus.subscribe(FakeEvent, lambda e: received.append(e))
    event = FakeEvent(value="hello")
    bus.emit(event)
    assert received == [event]


def test_multiple_handlers():
    bus = EventBus()
    log1, log2 = [], []
    bus.subscribe(FakeEvent, lambda e: log1.append(e.value))
    bus.subscribe(FakeEvent, lambda e: log2.append(e.value))
    bus.emit(FakeEvent(value="x"))
    assert log1 == ["x"]
    assert log2 == ["x"]


def test_handler_error_does_not_propagate():
    bus = EventBus()
    results = []

    def bad_handler(e):
        raise RuntimeError("boom")

    def good_handler(e):
        results.append(e.value)

    bus.subscribe(FakeEvent, bad_handler)
    bus.subscribe(FakeEvent, good_handler)
    bus.emit(FakeEvent(value="ok"))
    assert results == ["ok"]


def test_no_cross_talk_between_event_types():
    @dataclass
    class OtherEvent(Event):
        x: int = 0

    bus = EventBus()
    fake_log, other_log = [], []
    bus.subscribe(FakeEvent, lambda e: fake_log.append(e))
    bus.subscribe(OtherEvent, lambda e: other_log.append(e))
    bus.emit(FakeEvent(value="a"))
    assert len(fake_log) == 1
    assert len(other_log) == 0
