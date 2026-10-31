"""Keep Telegram bot tokens out of every log line.

The Bot API puts the token in the URL path (`/bot<id>:<secret>/getUpdates`),
and httpx logs each request URL at INFO. With the bot long-polling every 30 s,
that wrote the token to `docker compose logs pipeline` twice a minute, which
#1117 did not cover: it cleaned the errors Podlog raises itself, not lines
other libraries log.

Redacting the pattern at the root handler covers every logger, including
tracebacks, rather than relying on each library to stay quiet.
"""
import logging
import re

# bot<numeric id>:<secret>, the shape BotFather issues.
_BOT_TOKEN = re.compile(r"bot\d+:[A-Za-z0-9_-]+")
REDACTED = "bot<redacted>"


def redact(text: str) -> str:
    return _BOT_TOKEN.sub(REDACTED, text)


class RedactBotTokenFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        clean = redact(message)
        if clean != message:
            record.msg, record.args = clean, None
        if record.exc_info and not record.exc_text:
            # Formatter reuses exc_text when set, so format the traceback here.
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def install() -> None:
    """Attach the filter to the root handlers. Call after logging.basicConfig."""
    for handler in logging.getLogger().handlers:
        if not any(isinstance(f, RedactBotTokenFilter) for f in handler.filters):
            handler.addFilter(RedactBotTokenFilter())
