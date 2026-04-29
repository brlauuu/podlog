"""
Explore service status endpoint (#607 PR 2).

Reports whether the optional Jupyter-based DB exploration service is
reachable. The web UI uses this to render a small subtle indicator on
the Meta-Analysis page.

Detection is a probe to the Jupyter root API on the internal Docker
network (``http://explore:8888/api``). The user-facing URL we report is
``http://localhost:8888/lab`` (the host port mapping, not the internal
service hostname). When the service is opt-in via the ``explore``
Compose profile and not running, DNS resolution of ``explore`` fails
and we report ``running=false``.
"""
import logging

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()

# Internal hostname is the compose service name. The probe must be quick
# because it runs on every page load of /meta-analysis — a stalled DNS
# lookup or a slow handshake would block the page render.
_INTERNAL_PROBE_URL = "http://explore:8888/api"
_PROBE_TIMEOUT_SECS = 2.0

# What the user clicks. Compose binds 8888 to 127.0.0.1 on the host
# (apps/explore + docker-compose.yml). The token is appended client-side
# from the user's logs; we don't surface it here because we don't have
# the running container's stdout. The bare URL lands on Jupyter's token
# entry page, which is the documented flow.
_HOST_URL = "http://localhost:8888/lab"


@router.get("/explore/status")
async def get_explore_status() -> dict:
    """Probe the explore service. Soft-fails with `running=false`."""
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECS) as client:
            resp = await client.get(_INTERNAL_PROBE_URL)
        # Any 2xx/3xx/4xx confirms there's *something* answering on that port —
        # Jupyter returns 200 on /api with no auth. A 5xx means it's confused
        # but reachable, which we still treat as "up enough to link to".
        running = 200 <= resp.status_code < 600
        return {
            "running": running,
            "url": _HOST_URL if running else None,
            "error": None,
        }
    except httpx.HTTPError as exc:
        # ConnectError / ConnectTimeout / unresolvable host all land here.
        # Don't bubble the underlying networking error to the user; the UI
        # only needs to know "not running" + a link to the docs.
        logger.debug(
            '"action": "explore_status_probe_failed", "error": "%s"',
            type(exc).__name__,
        )
        return {"running": False, "url": None, "error": None}
