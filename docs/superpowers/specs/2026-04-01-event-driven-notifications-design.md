# Event-Driven Notification System

**Date:** 2026-04-01
**Status:** Proposed

## Overview

Add an in-process event bus to the pipeline that decouples "what happened" from "who cares." Notifications are sent when episodes complete or fail, via email (HTML) and/or Telegram (Markdown). The system is designed for extensibility — new event types and notification channels can be added with minimal boilerplate.

## Architecture

```
Pipeline tasks                    Event Bus                     Handlers
─────────────                    ─────────                     ────────
archive_episode() ──emit──▶  EventBus.emit("episode.done")  ──▶ EmailHandler
mark_failed()     ──emit──▶  EventBus.emit("episode.failed") ──▶ TelegramHandler
(future) infer()  ──emit──▶  EventBus.emit("topic.matched")  ──▶ Any handler
```

- **Events** are dataclasses carrying all data needed for notification formatting.
- **EventBus** is a singleton registry. Handlers subscribe to event types; `emit()` calls all registered handlers.
- **Handlers** receive an event and deliver via a specific channel (email, Telegram, etc.).
- Handlers run **synchronously** within the pipeline task. Since the pipeline uses sequential processing (concurrency=1), there is no performance concern.
- A failed handler is caught and logged — it **never** crashes or affects the pipeline task.

## Event Types

### `EpisodeDoneEvent`

Emitted after `archive_episode()` verifies status=done.

| Field | Type | Source |
|---|---|---|
| `episode_id` | `str` | Episode.id |
| `episode_title` | `str` | Episode.title |
| `podcast_title` | `str` | Feed.title |
| `published_at` | `datetime` | Episode.published_at |
| `duration_secs` | `int` | Episode.duration_secs |
| `transcribe_duration_secs` | `float` | Episode.transcribe_duration_secs |
| `diarize_duration_secs` | `float` | Episode.diarize_duration_secs |
| `total_duration_secs` | `float` | Computed: processed_at - created_at |
| `queue_remaining` | `int` | Count of pending/in-progress episodes |
| `queue_estimated_secs` | `float \| None` | Duration-weighted estimate |

### `EpisodeFailedEvent`

Emitted from `mark_failed()` only when `retry_count >= retry_max` (final failure).

| Field | Type | Source |
|---|---|---|
| `episode_id` | `str` | Episode.id |
| `episode_title` | `str` | Episode.title |
| `podcast_title` | `str` | Feed.title |
| `published_at` | `datetime` | Episode.published_at |
| `duration_secs` | `int` | Episode.duration_secs |
| `error_class` | `str` | Episode.error_class |
| `error_message` | `str` | Episode.error_message |
| `retry_count` | `int` | Episode.retry_count |
| `retry_max` | `int` | Episode.retry_max |
| `queue_remaining` | `int` | Count of pending/in-progress episodes |
| `queue_estimated_secs` | `float \| None` | Duration-weighted estimate |

## Queue Time Estimation

The estimate uses a **duration-weighted processing rate**:

1. Query the last ~10 completed episodes that have both `duration_secs` and `processed_at`.
2. Compute average processing rate: `sum(total_processing_time) / sum(duration_secs)` — gives seconds of wall time per second of audio.
3. Sum `duration_secs` of all queued (pending + in-progress) episodes.
4. Estimated time = queued_duration * processing_rate.
5. If no history exists, return `None` (displayed as "unknown").

## Notification Channels

### Email (HTML)

**Default setup:** Uses the host machine's local MTA via `host.docker.internal:25`. Zero config beyond a recipient address.

**Optional override:** Full SMTP config for users who want a proper email provider.

**Env vars:**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NOTIFICATION_EMAIL_TO` | Yes (to enable) | — | Recipient address; presence enables email |
| `NOTIFICATION_EMAIL_FROM` | No | `podlog@localhost` | Sender address |
| `SMTP_HOST` | No | `host.docker.internal` | SMTP server |
| `SMTP_PORT` | No | `25` | SMTP port |
| `SMTP_USER` | No | — | For authenticated SMTP |
| `SMTP_PASSWORD` | No | — | For authenticated SMTP |
| `SMTP_USE_TLS` | No | `false` | Enable STARTTLS |

**Message format:** Clean single-column HTML layout with a table for stage timings. Inline CSS only (no external stylesheets). Compatible with all major email clients.

### Telegram (Markdown)

**Setup:** User creates a bot via BotFather, gets token and chat ID.

**Env vars:**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes (to enable) | — | Both must be set to enable Telegram |
| `TELEGRAM_CHAT_ID` | Yes (to enable) | — | User's chat ID |

**Delivery:** Single HTTP POST to `api.telegram.org` using `httpx`. No additional library needed.

**Message format:** Markdown with bold labels and monospace for timings.

## Opt-In Logic

- No notification env vars set = no notifications, no overhead.
- Each channel is independently enabled by the presence of its required env vars.
- Both channels can be active simultaneously.
- Config is added to the existing `Settings` pydantic-settings class with `None` defaults.
- Helper properties: `email_notifications_enabled`, `telegram_notifications_enabled`.

## Message Templates

### Success (episode done)

```
✅ Episode Processed: {episode_title}

Podcast:      {podcast_title}
Episode:      {episode_title}
Published:    {published_at}
Duration:     {h:mm:ss}

Processing Time:
  Transcription:  {transcribe_duration}
  Diarization:    {diarize_duration}
  Total:          {total_duration}

Queue Status:
  Remaining:      {N} episodes
  Est. time left: {estimated_time}
```

HTML email renders this as a styled table. Telegram uses Markdown formatting.

### Failure (episode failed)

```
❌ Episode Failed: {episode_title}

Podcast:      {podcast_title}
Episode:      {episode_title}
Published:    {published_at}
Duration:     {h:mm:ss}

Error:        {error_class}
Details:      {error_message}
Retries:      {retry_count}/{retry_max}

Queue Status:
  Remaining:      {N} episodes
  Est. time left: {estimated_time}
```

## Integration Points

### Emitting events

- **`archive_episode()`** in `app/tasks/archive.py` — emit `EpisodeDoneEvent` after the status=done verification (after line ~83).
- **`mark_failed()`** in `app/tasks/helpers.py` — emit `EpisodeFailedEvent` only when `retry_count >= retry_max`.

### Handler registration

On pipeline startup (`main.py`), the event bus is initialized and handlers are registered based on config:

```python
if settings.email_notifications_enabled:
    bus.subscribe(EpisodeDoneEvent, email_handler)
    bus.subscribe(EpisodeFailedEvent, email_handler)

if settings.telegram_notifications_enabled:
    bus.subscribe(EpisodeDoneEvent, telegram_handler)
    bus.subscribe(EpisodeFailedEvent, telegram_handler)
```

## New Files

| File | Purpose |
|---|---|
| `app/services/events.py` | EventBus singleton, base Event dataclass |
| `app/services/notifications.py` | Event dataclasses (EpisodeDoneEvent, EpisodeFailedEvent), queue estimation logic, message formatting, email/Telegram handlers |

## Extensibility Guide

### Adding a new event type

1. Define a new event dataclass in `app/services/notifications.py` (or a new module if unrelated to notifications).
2. Emit it from the relevant pipeline task.
3. Write a handler function or reuse existing channel handlers with a new message template.
4. Register the subscription on startup.

**Example future use case:** After the inference task identifies episode topics, emit a `TopicMatchedEvent` if any match a user-configured watch list (`NOTIFICATION_WATCH_TOPICS=ai,politics,tech`). The existing email/Telegram handlers format and deliver it.

### Adding a new notification channel

1. Write a new handler function that accepts an event and delivers via the new channel.
2. Add env vars for config to `Settings`.
3. Register the handler on startup.

The pattern is deliberately simple — no plugin system, no dynamic discovery. Just Python functions, env vars, and explicit registration.
