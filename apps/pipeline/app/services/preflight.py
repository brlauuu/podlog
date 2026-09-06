"""Startup pre-flight for local diarization (#1048).

The installation guide used to say that without accepting the pyannote
licence on HuggingFace "speaker diarization will silently fail". A mistyped
HF_TOKEN fails the same way. Both only showed up after a full transcription,
as an episode with `has_diarization = false` and an error nobody was looking
for. Both are cheap to test up front:

  1. GET https://huggingface.co/api/whoami-v2 with the token -> 401 means the
     token itself is bad.
  2. GET https://huggingface.co/api/models/<model>/auth-check -> 200 means
     this token may download the gated model, i.e. the licence has been
     accepted; anything else means it has not. (The plain model metadata
     endpoint answers 200 for everyone and is useless here; the auth-check
     mirrors what `Pipeline.from_pretrained` does when it fetches config.yaml.)

Rules:
- Never blocks anything. Diarization failure stays non-fatal (PRD-01 S5.5);
  this only says so earlier.
- SKIPPED when the diarization provider is the pyannote cloud (`precision2`):
  no HuggingFace access is needed then.
- UNKNOWN when HuggingFace cannot be reached: an offline install must not
  look broken.
- Cached for PREFLIGHT_TTL_SECS so the health endpoint's polling does not
  hammer HuggingFace; an accepted licence clears within that window with no
  restart.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Literal

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.services.notification_settings import get_runtime_diarization_settings

logger = logging.getLogger(__name__)

HF_API = "https://huggingface.co"
PREFLIGHT_TTL_SECS = 300
TIMEOUT_SECS = 10

Status = Literal["OK", "FAILED", "UNKNOWN", "SKIPPED"]


@dataclass(frozen=True)
class PreflightResult:
    status: Status
    detail: str
    model: str | None = None


def check_hf_access(
    token: str | None, model: str, *, client: httpx.Client | None = None
) -> PreflightResult:
    """Pure check: token validity, then gated-model access. No caching."""
    if not token:
        return PreflightResult(
            "FAILED", "HF_TOKEN is not set; local diarization needs a HuggingFace token.", model
        )
    headers = {"Authorization": f"Bearer {token}"}
    own = client is None
    c = client or httpx.Client(timeout=TIMEOUT_SECS)
    try:
        try:
            who = c.get(f"{HF_API}/api/whoami-v2", headers=headers)
        except httpx.HTTPError as exc:
            return PreflightResult(
                "UNKNOWN", f"HuggingFace not reachable ({type(exc).__name__}); could not verify.", model
            )
        if who.status_code == 401:
            return PreflightResult(
                "FAILED",
                "HF_TOKEN is not accepted by HuggingFace (401). Check the token in .env.",
                model,
            )
        if who.status_code != 200:
            return PreflightResult(
                "UNKNOWN", f"HuggingFace answered {who.status_code} to whoami; could not verify.", model
            )
        try:
            gate = c.get(f"{HF_API}/api/models/{model}/auth-check", headers=headers)
        except httpx.HTTPError as exc:
            return PreflightResult(
                "UNKNOWN", f"HuggingFace not reachable ({type(exc).__name__}); could not verify.", model
            )
        if gate.status_code == 200:
            return PreflightResult("OK", "HuggingFace token valid, model licence accepted.", model)
        if gate.status_code in (401, 403):
            return PreflightResult(
                "FAILED",
                f"The licence for {model} has not been accepted for this token. "
                f"Open https://huggingface.co/{model}, click \"Agree and access repository\", "
                "then wait a few minutes.",
                model,
            )
        if gate.status_code == 404:
            return PreflightResult(
                "FAILED", f"HuggingFace has no model called {model}. Check PYANNOTE_MODEL.", model
            )
        return PreflightResult(
            "UNKNOWN", f"HuggingFace answered {gate.status_code} to auth-check; could not verify.", model
        )
    finally:
        if own:
            c.close()


_cache: tuple[float, PreflightResult] | None = None


def diarization_preflight(db: Session | None = None, *, force: bool = False) -> PreflightResult:
    """Cached check against the runtime diarization settings."""
    global _cache
    now = time.monotonic()
    if not force and _cache is not None and now - _cache[0] < PREFLIGHT_TTL_SECS:
        return _cache[1]
    try:
        runtime = get_runtime_diarization_settings(db)
    except Exception:
        runtime = {}
    provider = runtime.get("diarization_provider") or settings.diarization_provider
    if provider == "precision2":
        result = PreflightResult("SKIPPED", "Cloud diarization (pyannote.ai) needs no HuggingFace access.")
    else:
        model = runtime.get("pyannote_model") or settings.pyannote_model
        result = check_hf_access(settings.hf_token, model)
    _cache = (now, result)
    return result


def reset_cache() -> None:
    global _cache
    _cache = None
