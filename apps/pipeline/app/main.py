import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import ask, backfill, backups, feeds, episodes, queue, health, embed, explore, notifications, hardware, meta_analysis, prompts
from app.services.events import bus
from app.services.digest import register_notification_handlers
from app.services import telegram_bot

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
)

logger = logging.getLogger(__name__)


def _read_version() -> str:
    """Read version from the VERSION file (repo root in dev, /app in Docker)."""
    for candidate in (
        Path(__file__).resolve().parent.parent.parent.parent / "VERSION",  # dev: repo root
        Path(__file__).resolve().parent.parent / "VERSION",  # Docker: /app/VERSION via COPY . .
    ):
        if candidate.exists():
            return candidate.read_text().strip()
    return "0.0.0"


__version__ = _read_version()

register_notification_handlers(bus)



@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Run the Telegram bot's long-poll loop for the life of the process (#1034).

    The loop idles (no network calls) until a bot token and a non-empty
    allowlist are configured, so this is a no-op on a fresh install.
    """
    task = asyncio.create_task(telegram_bot.run_forever(), name="telegram-bot")
    try:
        yield
    finally:
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        except Exception as exc:  # never let a bot error delay shutdown
            logger.warning('"action": "telegram_bot_shutdown_error", "error": "%s"', exc)


app = FastAPI(title="Podlog Pipeline API", version=__version__, lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        '"action": "unhandled_error", "path": "%s", "error": "%s"',
        request.url.path,
        exc,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(exc).__name__}"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(feeds.router, prefix="/api")
app.include_router(episodes.router, prefix="/api")
app.include_router(queue.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(embed.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(ask.router, prefix="/api")
app.include_router(backfill.router, prefix="/api")
app.include_router(hardware.router, prefix="/api")
app.include_router(meta_analysis.router, prefix="/api")
app.include_router(explore.router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")
