import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import feeds, episodes, queue, health

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Podlog Pipeline API", version="0.1.0")


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
