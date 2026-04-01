import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import feeds, episodes, queue, health, embed
from app.config import settings
from app.services.events import bus
from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    send_email,
    send_telegram,
)

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Podlog Pipeline API", version="0.1.0")

# Register notification handlers based on config
if settings.email_notifications_enabled:
    def _email_handler(event):
        send_email(
            event,
            to_addr=settings.notification_email_to,
            from_addr=settings.notification_email_from,
            smtp_host=settings.smtp_host,
            smtp_port=settings.smtp_port,
            smtp_user=settings.smtp_user,
            smtp_password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
        )
    bus.subscribe(EpisodeDoneEvent, _email_handler)
    bus.subscribe(EpisodeFailedEvent, _email_handler)

if settings.telegram_notifications_enabled:
    def _telegram_handler(event):
        send_telegram(event, bot_token=settings.telegram_bot_token, chat_id=settings.telegram_chat_id)
    bus.subscribe(EpisodeDoneEvent, _telegram_handler)
    bus.subscribe(EpisodeFailedEvent, _telegram_handler)


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
