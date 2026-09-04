# PRD-07: Telegram Bot — Remote Window into Podlog

**Project:** Podlog — Self-hosted Podcast Transcription & Search
**Document:** PRD-07 — Telegram bot (inbound long-poll loop, user allowlist, chat commands)
**Version:** 1.1
**Status:** Foundation shipped (#1034), `/search` shipped (#1035); `/ask` and `/transcript` tracked in #1036, #1037 under epic #1030
**Depends on:** PRD-02 (queue dashboard contract, search, Ask), PRD-03 (compose layout, security model)

**Changelog:**
- v1.1 — `/search` (#1035): the web app's search route is the source; `WEB_INTERNAL_URL` and `PODLOG_LAN_URL` added to the pipeline config; paging via a `pN` suffix rather than callback queries, so the loop keeps subscribing to `message` updates only.
- v1.0 — Initial. Specifies the inbound loop, the allowlist and the four foundation commands; reserves sections for the three follow-up commands.

---

## 1. Problem Statement

Podlog's web UI is reachable only on the LAN, by design (PRD-03, #960). Using it from a phone elsewhere means a VPN or exposing port 3000, both of which the security model advises against. Podlog already has a Telegram bot for outbound notifications (PRD-01 notifications, #91). Letting that bot answer commands gives remote, read-only access through Telegram's servers with nothing opened on the router, and without building a mobile app.

## 2. Goals and Non-Goals

**Goals**
- Query Podlog from any Telegram client, from anywhere, without network changes.
- The operator chooses exactly which Telegram accounts may do so.
- Zero behaviour change for installs that do not opt in.

**Non-Goals**
- Any write action (retry, delete, feed CRUD, settings). Each would need its own issue and confirmation step.
- Webhooks. They need a public HTTPS endpoint, which is the thing this feature avoids.
- Group-chat administration, inline mode, or multi-bot setups.

## 3. Architecture

| Concern | Decision | Why |
|---|---|---|
| Transport | Long polling `getUpdates`, 30 s timeout, `allowed_updates=["message"]` | No inbound port. One consumer per token — the loop is it, so the manual `getUpdates` URL in the setup guide goes quiet once the bot runs. |
| Host process | `pipeline` control plane, asyncio task from the FastAPI lifespan (`app/main.py`) | Only long-lived async process never blocked by a job. `worker` is synchronous and blocks for minutes. No new container. |
| Module | `app/services/telegram_bot.py` | `TelegramBot` class with injected `httpx.AsyncClient`, DB factory, settings reader and sleep, so tests drive it through `httpx.MockTransport`. |
| Queue read | `app/services/queue_snapshot.py`, shared with `GET /api/queue` | The bot must not import from the API layer. Response shape unchanged. |
| Configuration | `telegram_allowed_user_ids` in the notification settings row (`system_state`), env fallback `TELEGRAM_ALLOWED_USER_IDS`; re-read every iteration | UI changes apply without restart. Same env-over-DB precedence as every other notification field. |
| Replies | Plain text, no `parse_mode`, ≤ 4096 chars | Episode titles cannot break Markdown escaping. |

## 4. Authorisation

- **Identity** is the numeric Telegram user ID from `message.from.id`. Not usernames (optional, mutable) and not phone numbers (never exposed to bots).
- **Deny by default.** The loop makes no network call until a bot token *and* a non-empty allowlist are configured. Empty means off.
- **Refusal** is a fixed one-line reply; the refused ID and username are logged (`telegram_bot_refused`) so the operator can copy the ID into the list.
- **`/whoami` answers everyone**, with nothing but the sender's own ID. It is the bootstrap path for a second user. The first user's ID is the Chat ID they already have from notification setup (in a private chat the two are equal).
- Risk entry: RISKS-AND-GAPS RISK-12.

## 5. Commands

| Command | Auth | Reply | Source |
|---|---|---|---|
| `/start`, `/help` | listed | command list | — |
| `/whoami` | anyone | `Your Telegram user id is N.` | — |
| `/queue` | listed | counts, running episode + stage, up to 5 pending, up to 5 latest failures with error class, stuck count | `queue_snapshot()` |
| `/search <q> [pN]` | listed | 5 hits per page: feed, episode, speaker, timestamp, ~160-char snippet around the first match, deep link when `PODLOG_LAN_URL` is set; footer with the remaining count and the next-page command | web `GET /api/search` over `WEB_INTERNAL_URL` (#1035) |
| `/ask <q>` | listed | reserved — #1036 | pipeline `/api/ask` (SSE) |
| `/transcript <ep>` | listed | reserved — #1037 | web transcript export route |

Unknown commands and plain text from a listed user return the command list. Commands are case-insensitive and accept the `@BotName` suffix Telegram appends in groups.

## 6. Failure Handling

- HTTP 409 on `getUpdates` (another consumer) → `telegram_bot_conflict`, exponential back-off 5 s → 300 s.
- Any other poll failure → `telegram_bot_poll_failed`, same back-off; back-off resets on the next success.
- A command that raises → `telegram_bot_command_failed`, a generic apology to the chat, offset still advances so the update is not replayed forever.
- A failed `sendMessage` → `telegram_bot_send_failed`, processing continues.
- Nothing in the loop can propagate to the FastAPI process; shutdown cancels the task with a 5 s bound.

## 7. Observability

Structured log actions: `telegram_bot_idle` (once per reason change), `telegram_bot_active`, `telegram_bot_command` (user id, command, duration), `telegram_bot_refused`, `telegram_bot_conflict`, `telegram_bot_poll_failed`, `telegram_bot_command_failed`, `telegram_bot_send_failed`.

## 8. Testing

`tests/unit/test_telegram_bot.py`: allowlist parsing, deny-by-default, `/whoami` for unlisted users, each command, `/queue` formatting (empty, truncation, 4096 cap), and the loop against a mock transport — no network call with a missing token or empty allowlist, offset advancement, 409 and network back-off with cap and reset, command and send failures, settings change without restart, cancellation. `tests/unit/test_notification_settings.py::TestTelegramAllowedUserIds` covers save-time validation.
