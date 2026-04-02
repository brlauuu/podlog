# Notification Settings UI — Design Spec

**Date:** 2026-04-01
**Status:** Draft

## Goal

Add a `/notifications` page to the web UI where users can configure Telegram and email notification settings, set delivery frequency, send test messages, and follow step-by-step setup guides — all without editing `.env` or restarting Docker containers.

## Scope

- New `/notifications` page with tabbed UI (Telegram, Email, General)
- DB-backed settings (stored in `system_state` table), with env var fallback
- Setup guides integrated into each tab
- "Send test" buttons for both channels
- Pipeline reads settings from DB at notification time, not just at startup
- No new database tables — uses existing `system_state` key-value store

## UI Design

### Navigation

Add "Notifications" link to the Navbar, positioned after "Queue":

```
Podlog   Search   Podcasts   Queue   Notifications   [dark mode toggle]
```

### Page Layout

Route: `/notifications`
Title: "Notification Settings"

Three tabs with status dots:
- **Telegram** — green dot if bot token + chat ID are set, grey otherwise
- **Email** — green dot if "Send to" address is set, grey otherwise
- **General** — no status dot (always has a value)

### Telegram Tab

1. **Status badge**: "Configured" (green) or "Not configured" (grey)

2. **Setup guide** (collapsible):
   - Expanded by default if not configured, collapsed if configured
   - Title: "How to set up Telegram notifications"
   - Steps:
     1. Open Telegram and search for **@BotFather**
     2. Send `/newbot` and follow the prompts to create a bot
     3. Copy the **bot token** (looks like `123456:ABC-DEF...`) and paste it below
     4. Start a chat with your new bot (send it any message)
     5. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser
     6. Find `"chat":{"id":123456789}` in the response — that's your **Chat ID**

3. **Fields**:
   - Bot Token (password input with show/hide toggle)
     - Hint: "The token you received from @BotFather when creating your bot"
   - Chat ID (text input)
     - Hint: "Your personal chat ID — find it via the getUpdates API call above"

4. **Buttons**: "Save" (primary) + "Send test message" (secondary, disabled until saved)

### Email Tab

1. **Status badge**: "Configured" (green) or "Not configured" (grey)

2. **Setup guide** (collapsible):
   - Expanded by default if not configured, collapsed if configured
   - Title: "How to set up email notifications"
   - Steps:
     1. If you have a local mail server (postfix, sendmail), just enter your email address below and Save — the defaults will work
     2. For external providers (Gmail, Fastmail, etc.), expand "SMTP Configuration" below
     3. For **Gmail**: enable 2FA, then create an App Password in Google account settings. Use `smtp.gmail.com` port `587` with TLS enabled
     4. For other providers, check their SMTP documentation for host/port/TLS settings

3. **Fields (always visible)**:
   - Send to (email input, required)
     - Hint: "Email address that receives notifications"
   - From address (email input)
     - Hint: "Sender address shown in notifications"
     - Default: `podlog@localhost`

4. **SMTP Configuration** (collapsible section, collapsed by default):
   - Header: "SMTP Configuration (optional — defaults work with local mail servers)"
   - Fields:
     - SMTP Host (text) — default: `host.docker.internal`
       - Hint: "Leave default for local mail server, or use e.g. smtp.gmail.com"
     - SMTP Port (number) — default: `25`
       - Hint: "25 for local, 587 for TLS, 465 for SSL"
     - SMTP Username (text, optional)
       - Hint: "Usually your email address — leave empty for local mail server"
     - SMTP Password (password with show/hide, optional)
       - Hint: "App password or SMTP credential"
     - Enable TLS (checkbox, default: off)
       - Hint: "Required for Gmail, Outlook, and most external providers"

5. **Buttons**: "Save" (primary) + "Send test email" (secondary, disabled until saved)

### General Tab

1. **Notification Frequency** (select dropdown):
   - Options:
     - "Immediate — notify after each episode" (default)
     - "Daily digest — summary at 8:00 AM UTC"
     - "Weekly digest — summary on Monday at 8:00 AM UTC"
   - Hint: "Controls success notifications. Failures are always sent immediately."

2. **Button**: "Save" (primary)

## Data Storage

### `system_state` Table

Settings are stored as a single JSON blob under key `notification_settings`:

```json
{
  "telegram_bot_token": "123456:ABC-DEF...",
  "telegram_chat_id": "123456789",
  "notification_email_to": "user@example.com",
  "notification_email_from": "podlog@localhost",
  "smtp_host": "host.docker.internal",
  "smtp_port": 25,
  "smtp_user": null,
  "smtp_password": null,
  "smtp_use_tls": false,
  "notification_frequency": "immediate"
}
```

If the key doesn't exist, all values fall back to the current env var defaults (via `config.py`).

### Settings Resolution Order

When the pipeline needs a notification setting:
1. Read `notification_settings` from `system_state` table
2. If the key exists and the field is non-null, use the DB value
3. Otherwise, fall back to the env var value from `config.py`

This ensures existing `.env` deployments keep working, while UI-configured settings take precedence.

## API Design

### Web App Routes (Next.js)

These proxy to the pipeline API since notification settings are owned by the pipeline service.

**`GET /api/notifications/settings`**
- Proxies to pipeline `GET /api/notifications/settings`
- Returns the current settings (merged DB + env var defaults)
- Sensitive fields (bot token, SMTP password) are masked in the response (e.g., `"123***w11"`) — full values are only stored, never returned

**`PUT /api/notifications/settings`**
- Proxies to pipeline `PUT /api/notifications/settings`
- Body: partial settings object (only include fields being updated)
- Pipeline validates and merges into the `system_state` row

**`POST /api/notifications/test`**
- Proxies to pipeline `POST /api/notifications/test`
- Body: `{ "channel": "telegram" }` or `{ "channel": "email" }`
- Pipeline sends a test notification using current settings
- Returns `{ "ok": true }` or `{ "error": "description" }`

### Pipeline API Endpoints (FastAPI)

**`GET /api/notifications/settings`**
- Reads `notification_settings` from `system_state`
- Merges with env var defaults (env vars fill any missing fields)
- Masks sensitive values before returning
- Returns full settings object with a `telegram_configured` and `email_configured` boolean

**`PUT /api/notifications/settings`**
- Accepts partial settings object
- Validates: `notification_frequency` must be one of `immediate`, `daily`, `weekly`; `smtp_port` must be a positive integer if provided
- Upserts into `system_state` (reads existing, merges, writes back)
- Returns the updated (masked) settings

**`POST /api/notifications/test`**
- Reads current settings (DB + env var fallback)
- Sends a test notification: "This is a test notification from Podlog" with current timestamp
- For Telegram: calls `sendMessage` via bot API
- For email: sends a simple HTML email via SMTP
- Returns `{ "ok": true }` on success, `{ "error": "..." }` on failure (with details like "SMTP connection refused" or "Telegram API returned 401")

## Pipeline Changes

### New: `app/services/notification_settings.py`

Central module for reading notification settings from DB with env var fallback:

```python
def get_notification_settings(db: Session) -> dict:
    """Read notification settings from system_state, falling back to env vars."""
    ...

def save_notification_settings(db: Session, updates: dict) -> dict:
    """Merge updates into existing settings and persist."""
    ...

def mask_sensitive(settings: dict) -> dict:
    """Mask bot_token and smtp_password for API responses."""
    ...
```

### Modify: `app/services/digest.py`

Replace direct `settings.telegram_bot_token` etc. references with a call to `get_notification_settings(db)`. The function already receives a `db` session. This is the key change that makes DB-backed settings work — the pipeline reads fresh settings from DB on each notification send, not from the static `config.py` singleton.

### New router: `app/api/notifications.py`

Three endpoints as described above, mounted on the FastAPI app.

## Component Structure

### New Files

| File | Description |
|---|---|
| `apps/web/src/app/notifications/page.tsx` | Server component — page shell with title |
| `apps/web/src/components/NotificationSettings.tsx` | Client component — tabs, forms, save/test logic |
| `apps/web/src/app/api/notifications/settings/route.ts` | GET/PUT proxy to pipeline |
| `apps/web/src/app/api/notifications/test/route.ts` | POST proxy to pipeline |
| `apps/pipeline/app/api/notifications.py` | FastAPI router — settings CRUD + test send |
| `apps/pipeline/app/services/notification_settings.py` | Settings read/write/mask logic |

### Modified Files

| File | Change |
|---|---|
| `apps/web/src/components/Navbar.tsx` | Add "Notifications" link |
| `apps/pipeline/app/main.py` | Mount notifications router |
| `apps/pipeline/app/services/digest.py` | Read settings from DB instead of `config.py` |

## User Feedback

- **Save**: brief loading spinner on button, then green toast "Settings saved"
- **Test**: brief loading spinner, then green toast "Test message sent" or red toast with error details
- **Validation errors**: inline red text below the field (e.g., "Invalid port number")

## Testing

### Pipeline Unit Tests

- `get_notification_settings` returns env var defaults when no DB row exists
- `get_notification_settings` returns DB values when row exists
- `get_notification_settings` merges: DB values override env vars, missing DB fields fall back
- `save_notification_settings` creates row if not exists
- `save_notification_settings` merges partial updates
- `mask_sensitive` masks token and password correctly
- Validation rejects invalid frequency values
- Validation rejects non-integer port

### Web Unit Tests

- NotificationSettings renders three tabs
- Tab switching shows correct content
- Save button calls PUT endpoint
- Test button calls POST endpoint
- Test button disabled when channel not configured
- Status badges reflect configuration state
