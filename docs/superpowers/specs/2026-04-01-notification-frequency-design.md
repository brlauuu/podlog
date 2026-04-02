# Notification Frequency (Immediate / Daily / Weekly Digest)

**Date:** 2026-04-01
**Status:** Proposed
**Depends on:** Event-driven notification system (#91)

## Overview

Extend the notification system to support three delivery frequencies: immediate (current default), daily digest, and weekly digest. Success notifications are batched into digests; failure notifications are always sent immediately regardless of frequency setting.

## Configuration

Single env var added to `Settings`:

| Variable | Values | Default | Notes |
|---|---|---|---|
| `NOTIFICATION_FREQUENCY` | `immediate`, `daily`, `weekly` | `immediate` | Controls success notification delivery |

- `immediate` — current behavior, no changes needed
- `daily` — success events accumulated, digest sent at 8am daily
- `weekly` — success events accumulated, digest sent Monday 8am

## Data Model

### New table: `notification_log`

| Column | Type | Notes |
|---|---|---|
| `id` | `Integer` PK | Auto-increment |
| `event_type` | `Text` NOT NULL | `episode.done` or `episode.failed` |
| `episode_id` | `UUID FK` | References `episodes.id` ON DELETE CASCADE |
| `payload` | `Text` NOT NULL | JSON-serialized event data |
| `sent` | `Boolean` NOT NULL | Default `false`, set `true` after included in digest or sent immediately |
| `created_at` | `DateTime(tz)` NOT NULL | Server default `now()` |

### New SQLAlchemy model: `NotificationLog`

Added to `app/models.py`. Index on `(sent, created_at)` for efficient unsent-event queries.

### system_state usage

The existing `system_state` table stores `last_digest_sent_at` (ISO datetime string) to track when the last digest was sent. This survives worker restarts.

## Handler Behavior by Frequency

### `immediate` mode (default)

No change from current implementation. `EpisodeDoneEvent` and `EpisodeFailedEvent` are sent directly via `send_email`/`send_telegram`.

### `daily` / `weekly` mode

**EpisodeDoneEvent:**
- Handler serializes the event to JSON and inserts a row into `notification_log` with `sent=false`.
- No notification is sent at this point.

**EpisodeFailedEvent:**
- Sent immediately via `send_email`/`send_telegram` (failures are always urgent).
- Also logged to `notification_log` with `sent=true` so the digest doesn't double-send.

## Digest Periodic Task

A new function `send_digest_if_due()` registered in the worker's `PERIODIC_TASKS` list, checked every 15 minutes.

### Logic

1. If `NOTIFICATION_FREQUENCY` is `immediate`, return immediately (no-op).
2. Read `last_digest_sent_at` from `system_state`.
3. Determine if a digest is due:
   - `daily`: current time >= 8:00 AND `last_digest_sent_at` is before today 8:00 (or NULL).
   - `weekly`: current time >= Monday 8:00 AND `last_digest_sent_at` is before this Monday 8:00 (or NULL).
4. If not due, return.
5. Query `notification_log` where `sent=false`, ordered by `created_at`.
6. If no unsent events, update `last_digest_sent_at` and return (no empty digests).
7. Compute current queue status (remaining count + duration-weighted estimate) fresh at send time.
8. Format digest message (HTML for email, Markdown for Telegram).
9. Send via configured channels.
10. Mark all queried rows as `sent=true`.
11. Update `last_digest_sent_at` in `system_state`.

### Error handling

If digest delivery fails, the rows stay `sent=false` and will be retried at the next 15-minute check. `last_digest_sent_at` is NOT updated on failure.

## Digest Message Format

### Success digest

```
📋 Podlog Daily Digest — Mar 15, 2026

3 episodes processed, 1 failed

✅ "How AI Works" (Tech Talk) — 1:00:00, processed in 3m 20s
✅ "Episode 42" (My Podcast) — 0:45:00, processed in 2m 10s
❌ "Bad Episode" (Other Pod) — OOM after 3/3 retries

Queue: 5 remaining · Est. 2:30:00
```

- Title line changes for weekly: "Podlog Weekly Digest — Week of Mar 10, 2026"
- Each episode is one line with status icon, title, podcast, duration, and either processing time (success) or error summary (failure).
- Failed episodes are included in the digest for completeness even though they were already sent immediately.
- Queue status is computed at digest-send time, not from individual event data.

### HTML email

Clean single-column layout consistent with existing notification emails. Episode list rendered as a table with alternating row backgrounds. Same inline-CSS-only approach.

### Telegram

Markdown with bold headers, one line per episode, monospace for the queue line.

## Integration Points

### Handler registration (`worker.py` / `main.py`)

The registration logic branches on `settings.notification_frequency`:

- `immediate`: subscribe `send_email`/`send_telegram` to both event types (current behavior).
- `daily`/`weekly`: subscribe `log_event` handler to `EpisodeDoneEvent` (writes to DB). Subscribe both `log_event` (with `sent=true`) AND `send_email`/`send_telegram` to `EpisodeFailedEvent`.

### Worker periodic tasks

Add `send_digest_if_due` to `PERIODIC_TASKS` with a 15-minute interval.

### New files

| File | Purpose |
|---|---|
| `app/services/digest.py` | `log_event()` handler, `send_digest_if_due()` periodic task, digest formatting |

### Modified files

| File | Change |
|---|---|
| `app/models.py` | Add `NotificationLog` model |
| `app/config.py` | Add `notification_frequency` field |
| `app/worker.py` | Update handler registration logic, add digest to `PERIODIC_TASKS` |
| `app/main.py` | Update handler registration logic |
| `.env.example` | Add `NOTIFICATION_FREQUENCY` |

## Edge Cases

- **Empty digest:** Not sent. If no episodes were processed in the period, no notification goes out.
- **Worker restart:** No event loss — `notification_log` persists in DB, `last_digest_sent_at` is in `system_state`.
- **Frequency change:** Unsent events in `notification_log` are harmless. They'd be included if the user switches back to digest mode, or ignored in immediate mode.
- **First run:** `last_digest_sent_at` is NULL in `system_state`. The digest task treats NULL as "never sent" and sends on the first eligible window.
