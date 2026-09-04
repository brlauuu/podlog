"""Telegram bot: inbound long-poll loop, user allowlist and read-only commands (#1034).

Podlog's Telegram support used to be send-only (`notifications.py::send_telegram`).
This module adds the receiving half so a chat can be used as a remote window
into Podlog from outside the home network, without opening a port or
running a VPN: the bot reaches Podlog through Telegram's servers.

Design (see issue #1034 and PRD-07):

- **Long polling, not webhooks.** A webhook needs a public HTTPS URL, which is
  exactly what this feature exists to avoid. The loop calls `getUpdates` with
  a 30 s timeout from inside the Docker network. Telegram allows one
  `getUpdates` consumer per token; this loop is that consumer, so the manual
  `getUpdates` URL the old setup docs pointed at stops returning anything
  once the bot runs. `/whoami` replaces it.
- **Runs in the control plane.** `app/main.py` starts `run_forever()` as an
  asyncio task from the FastAPI lifespan. Not in `worker`, whose main loop is
  synchronous and blocks for the length of a job.
- **Deny by default.** This is the first authenticated surface in Podlog.
  Anyone on Telegram who finds the bot's username can message it, so an
  empty allowlist means "answer nobody", not "answer everybody": the loop
  does not even call `getUpdates` until a token *and* at least one allowed
  user id are configured. Allowlisting is by numeric Telegram user id -- the
  Bot API never exposes phone numbers, and usernames are optional and
  mutable.
- **Settings are re-read every iteration**, so changes made in the Settings UI
  take effect without a restart.
- **Read-only.** No command here writes anything. Write commands (retry,
  delete) would need their own confirmation step and their own issue.
- **Plain-text replies.** No `parse_mode`, so an episode title containing
  Markdown characters cannot break a message.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.notification_settings import get_notification_settings
from app.services.queue_snapshot import queue_snapshot

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
POLL_TIMEOUT_SECS = 30
# How long to sleep between settings checks while the bot is not configured.
IDLE_RECHECK_SECS = 30
BACKOFF_INITIAL_SECS = 5
BACKOFF_MAX_SECS = 300
# Telegram's hard cap on a single text message.
MAX_MESSAGE_CHARS = 4096
_TITLE_MAX = 70
_QUEUE_LIST_MAX = 5

REFUSAL_TEXT = "This bot is private."
HELP_TEXT = (
    "Podlog bot commands:\n"
    "/queue - what the pipeline is doing right now\n"
    "/whoami - show your Telegram user id\n"
    "/help - this list"
)


# --------------------------------------------------------------------------
# Pure helpers (no I/O) -- unit-tested directly.
# --------------------------------------------------------------------------


def parse_allowlist(raw: str | None) -> frozenset[int]:
    """Parse the comma-separated `telegram_allowed_user_ids` setting.

    Tolerates whitespace and empty entries; anything that is not an integer is
    dropped rather than raised, because this runs inside the poll loop and a
    bad value must disable the bot, not crash the control plane. The settings
    save path (`notification_settings.py`) rejects bad values up front.
    """
    if not raw:
        return frozenset()
    ids: set[int] = set()
    for part in str(raw).split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return frozenset(ids)


def _truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _title(row: dict) -> str:
    return _truncate(row.get("title") or "(untitled)", _TITLE_MAX)


def format_queue(snapshot: dict) -> str:
    """Render the `queue_snapshot()` dict as a short plain-text status."""
    active = snapshot.get("active_jobs") or []
    pending = snapshot.get("pending_jobs") or []
    failed = snapshot.get("failed_jobs") or []
    stuck = snapshot.get("stuck_jobs") or []
    done_count = int(snapshot.get("done_count") or 0)

    if not active and not pending and not failed and not stuck:
        return f"Queue is empty. {done_count} episodes done."

    lines = [
        f"Queue: {len(active)} active, {len(pending)} pending, "
        f"{len(failed)} failed, {done_count} done"
    ]
    for row in active:
        lines.append(f"Running: {_title(row)} ({row.get('status') or 'working'})")
    if stuck:
        lines.append(f"Stuck: {len(stuck)} (see the Queue page)")
    if pending:
        lines.append("Pending:")
        for row in pending[:_QUEUE_LIST_MAX]:
            lines.append(f"- {_title(row)}")
        if len(pending) > _QUEUE_LIST_MAX:
            lines.append(f"- +{len(pending) - _QUEUE_LIST_MAX} more")
    if failed:
        lines.append("Recent failures:")
        for row in failed[:_QUEUE_LIST_MAX]:
            cls = row.get("error_class") or "error"
            lines.append(f"- {_title(row)} ({cls})")
        if len(failed) > _QUEUE_LIST_MAX:
            lines.append(f"- +{len(failed) - _QUEUE_LIST_MAX} more")
    return _truncate("\n".join(lines), MAX_MESSAGE_CHARS)


def _command_of(text: str) -> str | None:
    """Return the lower-cased command word of a message, or None.

    In groups Telegram sends commands as `/queue@BotName`; the suffix is
    stripped so the same handler serves both.
    """
    text = (text or "").strip()
    if not text.startswith("/"):
        return None
    word = text.split(maxsplit=1)[0]
    return word.split("@", 1)[0].lower()


def handle_update(
    update: dict,
    allowlist: frozenset[int],
    db_factory: Callable[[], Session],
) -> tuple[int, str] | None:
    """Route one Telegram update to a reply.

    Returns `(chat_id, text)` to send, or None when the update needs no reply
    (non-message updates, messages without text). Synchronous on purpose: the
    DB session is sync, and the caller runs this in a worker thread.
    """
    message = update.get("message")
    if not isinstance(message, dict):
        return None
    chat = message.get("chat") or {}
    sender = message.get("from") or {}
    chat_id = chat.get("id")
    user_id = sender.get("id")
    text = message.get("text")
    if chat_id is None or user_id is None or not isinstance(text, str):
        return None

    command = _command_of(text)

    # /whoami answers everyone: it is how a new operator finds the id to put
    # on the allowlist. It must not leak anything beyond the sender's own id.
    if command == "/whoami":
        return chat_id, f"Your Telegram user id is {user_id}."

    if user_id not in allowlist:
        logger.warning(
            '"action": "telegram_bot_refused", "user_id": %s, "username": "%s", "chat_id": %s',
            user_id,
            sender.get("username") or "",
            chat_id,
        )
        return chat_id, REFUSAL_TEXT

    if command in ("/start", "/help"):
        return chat_id, HELP_TEXT
    if command == "/queue":
        db = db_factory()
        try:
            return chat_id, format_queue(queue_snapshot(db))
        finally:
            db.close()
    if command is not None:
        return chat_id, f"Unknown command {command}.\n\n{HELP_TEXT}"
    return chat_id, HELP_TEXT


class TelegramApiError(Exception):
    """A Bot API call failed. Carries the status and Telegram's description only.

    Deliberately not an `httpx.HTTPStatusError`: that one's message embeds the
    request URL, and the URL embeds the bot token. Nothing built from this
    class can leak the token into a log line.
    """

    def __init__(self, method: str, status: int, description: str) -> None:
        super().__init__(f"{method} -> {status}: {description}")
        self.method = method
        self.status = status
        self.description = description


def _redact(token: str | None, text: str) -> str:
    """Belt and braces for any error string that might carry the token."""
    return text.replace(token, "<token>") if token else text


# --------------------------------------------------------------------------
# The loop.
# --------------------------------------------------------------------------


class TelegramBot:
    """Long-poll loop. Every collaborator is injectable so tests can drive it.

    `client` is an `httpx.AsyncClient` (tests pass one built on
    `httpx.MockTransport`); `sleep` defaults to `asyncio.sleep`.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        db_factory: Callable[[], Session] = SessionLocal,
        settings_reader: Callable[[Session], dict] = get_notification_settings,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self._client = client
        self._db_factory = db_factory
        self._settings_reader = settings_reader
        self._sleep = sleep
        self.offset: int | None = None
        self._backoff = BACKOFF_INITIAL_SECS
        # Logged once per state change, not once per iteration.
        self._last_idle_reason: str | None = None
        self._announced_active = False

    # -- configuration -------------------------------------------------------

    def _read_config(self) -> tuple[str | None, frozenset[int]]:
        db = self._db_factory()
        try:
            s = self._settings_reader(db)
        finally:
            db.close()
        return s.get("telegram_bot_token") or None, parse_allowlist(
            s.get("telegram_allowed_user_ids")
        )

    def _idle_reason(self, token: str | None, allowlist: frozenset[int]) -> str | None:
        if not token:
            return "no bot token configured"
        if not allowlist:
            return "allowlist is empty (set Allowed user IDs in Settings)"
        return None

    # -- Telegram API --------------------------------------------------------

    async def _api(self, method: str, token: str, **params: Any) -> dict:
        url = f"{API_BASE}/bot{token}/{method}"
        resp = await self._client.post(url, json=params)
        try:
            payload = resp.json()
        except ValueError:
            payload = {}
        if resp.status_code != 200 or not payload.get("ok"):
            raise TelegramApiError(
                method, resp.status_code, str(payload.get("description") or "no description")
            )
        return payload

    async def _send(self, token: str, chat_id: int, text: str) -> None:
        try:
            await self._api("sendMessage", token, chat_id=chat_id, text=text)
        except Exception as exc:  # a failed reply must not stop the loop
            logger.warning(
                '"action": "telegram_bot_send_failed", "error": "%s"', _redact(token, str(exc))
            )

    # -- one iteration -------------------------------------------------------

    async def poll_once(self) -> bool:
        """Run one iteration. Returns True if `getUpdates` was called.

        Never raises: every failure path logs, backs off and returns.
        """
        token, allowlist = await asyncio.to_thread(self._read_config)
        reason = self._idle_reason(token, allowlist)
        if reason is not None:
            if reason != self._last_idle_reason:
                logger.info('"action": "telegram_bot_idle", "reason": "%s"', reason)
                self._last_idle_reason = reason
                self._announced_active = False
            await self._sleep(IDLE_RECHECK_SECS)
            return False
        self._last_idle_reason = None
        if not self._announced_active:
            logger.info(
                '"action": "telegram_bot_active", "allowed_user_count": %d', len(allowlist)
            )
            self._announced_active = True
        assert token is not None

        params: dict[str, Any] = {
            "timeout": POLL_TIMEOUT_SECS,
            "allowed_updates": ["message"],
        }
        if self.offset is not None:
            params["offset"] = self.offset
        try:
            payload = await self._api("getUpdates", token, **params)
        except TelegramApiError as exc:
            if exc.status == 409:
                # Another process is polling with this token. Almost always a
                # second Podlog instance or a leftover manual getUpdates.
                logger.warning(
                    '"action": "telegram_bot_conflict", "detail": '
                    '"another getUpdates consumer is using this token"'
                )
            else:
                logger.warning(
                    '"action": "telegram_bot_poll_failed", "status": %s, "detail": "%s"',
                    exc.status,
                    _redact(token, exc.description),
                )
            await self._back_off()
            return True
        except Exception as exc:
            logger.warning(
                '"action": "telegram_bot_poll_failed", "error": "%s (%s)"',
                _redact(token, str(exc)),
                type(exc).__name__,
            )
            await self._back_off()
            return True
        self._backoff = BACKOFF_INITIAL_SECS

        for update in payload.get("result") or []:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                self.offset = update_id + 1
            await self._handle(token, allowlist, update)
        return True

    async def _handle(self, token: str, allowlist: frozenset[int], update: dict) -> None:
        started = asyncio.get_running_loop().time()
        try:
            reply = await asyncio.to_thread(handle_update, update, allowlist, self._db_factory)
        except Exception as exc:
            logger.error(
                '"action": "telegram_bot_command_failed", "error": "%s (%s)"',
                _redact(token, str(exc)),
                type(exc).__name__,
            )
            chat_id = ((update.get("message") or {}).get("chat") or {}).get("id")
            if chat_id is not None:
                await self._send(token, chat_id, "Something went wrong handling that command.")
            return
        if reply is None:
            return
        chat_id, text = reply
        await self._send(token, chat_id, text)
        message = update.get("message") or {}
        logger.info(
            '"action": "telegram_bot_command", "user_id": %s, "command": "%s", '
            '"duration_ms": %d',
            (message.get("from") or {}).get("id"),
            _command_of(message.get("text") or "") or "text",
            int((asyncio.get_running_loop().time() - started) * 1000),
        )

    async def _back_off(self) -> None:
        await self._sleep(self._backoff)
        self._backoff = min(self._backoff * 2, BACKOFF_MAX_SECS)

    async def run_forever(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # belt and braces: poll_once should not raise
                logger.error(
                    '"action": "telegram_bot_loop_error", "error": "%s (%s)"',
                    exc,
                    type(exc).__name__,
                )
                await self._back_off()


def new_client() -> httpx.AsyncClient:
    """Client whose read timeout outlives the long-poll timeout."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10, read=POLL_TIMEOUT_SECS + 15, write=10, pool=10)
    )


async def run_forever() -> None:
    """Entry point used by the FastAPI lifespan in `app/main.py`."""
    async with new_client() as client:
        await TelegramBot(client).run_forever()
