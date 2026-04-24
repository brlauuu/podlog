"""
pyannote.ai precision-2 cloud diarization service — PRD-01 §5.5, Issue #516.

Thin REST client for https://api.pyannote.ai/v1 that mirrors the error
classification used by the Fireworks provider so retries behave the same.

Flow:
  1. ``upload_audio`` — POST /media/input declares a media:// URL, then
     PUT the file bytes to the presigned URL the API returns.
  2. ``submit_diarization`` — POST /diarize with the media:// URL and
     model (``precision-2`` by default).
  3. ``poll_job`` — GET /jobs/{jobId} until status is terminal
     (``succeeded``, ``failed``, ``canceled``).
  4. ``diarize_via_cloud`` composes the three steps and returns the
     segments in Podlog's internal shape plus billed seconds and an
     estimated cost.

Pyannote cloud results auto-delete 24h after job completion; we fetch
the output in the same call, so this is not a concern operationally.

No GPU/RAM dance (PRD-01 §5.4) — the cloud path never loads a local
pyannote pipeline and can run alongside Whisper unloading without
coordination.
"""
from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


_TERMINAL_SUCCESS = "succeeded"
_TERMINAL_FAILURE = {"failed", "canceled"}
_NON_TERMINAL = {"pending", "created", "running"}

# Conservative polling: start small to catch fast jobs, cap growth.
_POLL_INITIAL_SECS = 2.0
_POLL_MAX_SECS = 10.0
_POLL_BACKOFF_FACTOR = 1.5
_POLL_TIMEOUT_SECS = 1800  # 30 minutes — covers long episodes comfortably

# 20-second minimum charge per request (pyannote.ai billing docs).
_MIN_BILLED_SECS = 20.0


class PyannoteCloudError(RuntimeError):
    """Typed pyannote cloud error carrying retry-class metadata."""

    def __init__(
        self,
        message: str,
        *,
        error_class: str,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.retryable = retryable
        self.status_code = status_code


def _classify_http_error(status_code: int) -> tuple[str, bool]:
    """Map HTTP statuses to Podlog retry classes. Mirrors Fireworks."""
    if status_code == 429 or 500 <= status_code <= 599:
        return "TRANSIENT_NETWORK", True
    return "HTTP_ACCESS", True


def _auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def _base(base_url: str) -> str:
    return base_url.rstrip("/")


def _wrap_network_error(action: str, exc: Exception) -> PyannoteCloudError:
    return PyannoteCloudError(
        f"pyannote cloud {action} network error: {exc}",
        error_class="TRANSIENT_NETWORK",
        retryable=True,
    )


def _wrap_http_error(action: str, exc: httpx.HTTPStatusError) -> PyannoteCloudError:
    status = exc.response.status_code
    error_class, retryable = _classify_http_error(status)
    return PyannoteCloudError(
        f"pyannote cloud {action} HTTP {status}",
        error_class=error_class,
        retryable=retryable,
        status_code=status,
    )


def verify_api_key(api_key: str, base_url: str) -> bool:
    """Ping GET /test to verify the API key. Returns True on 2xx, False on 401/403."""
    if not api_key:
        return False
    url = f"{_base(base_url)}/test"
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, headers=_auth_headers(api_key))
        return 200 <= resp.status_code < 300
    except httpx.HTTPError:
        return False


def upload_audio(audio_path: str, *, api_key: str, base_url: str) -> str:
    """Upload a local audio file to pyannote cloud temporary storage.

    Returns the ``media://...`` URL to pass as ``url`` to the diarize endpoint.
    """
    path = Path(audio_path)
    if not path.exists():
        raise RuntimeError(f"Audio file missing for pyannote cloud upload: {audio_path}")

    # Use a unique media key per upload; the documented path charset is
    # [alphanumeric, hyphen, underscore, dot, slash].
    media_key = f"podlog/{uuid.uuid4().hex}{path.suffix.lower() or '.bin'}"
    media_url = f"media://{media_key}"

    declare_url = f"{_base(base_url)}/media/input"
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=30.0, read=60.0, write=60.0, pool=30.0)) as client:
            resp = client.post(
                declare_url,
                headers={**_auth_headers(api_key), "Content-Type": "application/json"},
                json={"url": media_url},
            )
            resp.raise_for_status()
            payload = resp.json() or {}
    except httpx.TimeoutException as exc:
        raise _wrap_network_error("media/input", exc) from exc
    except httpx.NetworkError as exc:
        raise _wrap_network_error("media/input", exc) from exc
    except httpx.HTTPStatusError as exc:
        raise _wrap_http_error("media/input", exc) from exc

    presigned_url = payload.get("url") or payload.get("presignedUrl") or payload.get("uploadUrl")
    if not presigned_url:
        raise PyannoteCloudError(
            "pyannote cloud media/input returned no presigned URL",
            error_class="HTTP_ACCESS",
            retryable=False,
        )

    # PUT the audio bytes to the presigned URL. No Authorization header —
    # the presigned URL itself encodes the credential.
    try:
        with path.open("rb") as fh:
            with httpx.Client(timeout=httpx.Timeout(connect=30.0, read=600.0, write=600.0, pool=60.0)) as client:
                put_resp = client.put(presigned_url, content=fh.read())
                put_resp.raise_for_status()
    except httpx.TimeoutException as exc:
        raise _wrap_network_error("media upload", exc) from exc
    except httpx.NetworkError as exc:
        raise _wrap_network_error("media upload", exc) from exc
    except httpx.HTTPStatusError as exc:
        raise _wrap_http_error("media upload", exc) from exc

    logger.info(
        '"action": "pyannote_cloud_upload_complete", "media_url": "%s", "bytes": %d',
        media_url,
        path.stat().st_size,
    )
    return media_url


def submit_diarization(
    media_url: str,
    *,
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    """Submit a diarization job. Returns the ``jobId``."""
    url = f"{_base(base_url)}/diarize"
    body: dict = {"url": media_url, "model": model}
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                url,
                headers={**_auth_headers(api_key), "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
            payload = resp.json() or {}
    except httpx.TimeoutException as exc:
        raise _wrap_network_error("diarize submit", exc) from exc
    except httpx.NetworkError as exc:
        raise _wrap_network_error("diarize submit", exc) from exc
    except httpx.HTTPStatusError as exc:
        raise _wrap_http_error("diarize submit", exc) from exc

    job_id = payload.get("jobId") or payload.get("id")
    if not job_id:
        raise PyannoteCloudError(
            f"pyannote cloud diarize submit returned no jobId: {payload}",
            error_class="HTTP_ACCESS",
            retryable=False,
        )
    logger.info(
        '"action": "pyannote_cloud_submit_complete", "job_id": "%s", "model": "%s"',
        job_id,
        model,
    )
    return job_id


def poll_job(
    job_id: str,
    *,
    api_key: str,
    base_url: str,
    timeout_secs: float = _POLL_TIMEOUT_SECS,
    initial_interval_secs: float = _POLL_INITIAL_SECS,
    max_interval_secs: float = _POLL_MAX_SECS,
    sleep: callable = time.sleep,  # injectable for tests
) -> dict:
    """Poll GET /jobs/{id} until terminal. Returns the full payload on success.

    Raises PyannoteCloudError on failure/cancel/timeout.
    """
    url = f"{_base(base_url)}/jobs/{job_id}"
    deadline = time.monotonic() + timeout_secs
    interval = initial_interval_secs

    while True:
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=_auth_headers(api_key))
                resp.raise_for_status()
                payload = resp.json() or {}
        except httpx.TimeoutException as exc:
            raise _wrap_network_error(f"jobs/{job_id} poll", exc) from exc
        except httpx.NetworkError as exc:
            raise _wrap_network_error(f"jobs/{job_id} poll", exc) from exc
        except httpx.HTTPStatusError as exc:
            raise _wrap_http_error(f"jobs/{job_id} poll", exc) from exc

        status = (payload.get("status") or "").lower()
        if status == _TERMINAL_SUCCESS:
            return payload
        if status in _TERMINAL_FAILURE:
            err_msg = payload.get("error") or payload.get("message") or "<no detail>"
            raise PyannoteCloudError(
                f"pyannote cloud job {job_id} ended with status={status}: {err_msg}",
                error_class="HTTP_ACCESS",
                retryable=False,
            )
        if status not in _NON_TERMINAL:
            # Unknown status — treat as non-fatal and keep polling, but log.
            logger.warning(
                '"action": "pyannote_cloud_unknown_status", "job_id": "%s", "status": "%s"',
                job_id,
                status,
            )

        if time.monotonic() >= deadline:
            raise PyannoteCloudError(
                f"pyannote cloud job {job_id} exceeded {timeout_secs}s polling timeout "
                f"(last status={status!r})",
                error_class="TRANSIENT_NETWORK",
                retryable=True,
            )

        sleep(interval)
        interval = min(interval * _POLL_BACKOFF_FACTOR, max_interval_secs)


def _extract_segments(payload: dict) -> list[dict]:
    output = payload.get("output") or {}
    raw = output.get("diarization") or []
    segments: list[dict] = []
    for seg in raw:
        speaker = seg.get("speaker")
        start = seg.get("start")
        end = seg.get("end")
        if speaker is None or start is None or end is None:
            continue
        segments.append(
            {
                "speaker": _normalize_speaker(str(speaker)),
                "start": float(start),
                "end": float(end),
            }
        )
    return segments


def _compute_cost(segments: list[dict], cost_per_second_usd: float) -> tuple[float, float]:
    """Return (billed_secs, cost_usd).

    Billed seconds use the span from earliest start to latest end, floored at
    the 20-second per-request minimum. If cost_per_second_usd is <= 0, returns
    0.0 for cost so unconfigured rates don't emit a misleading dollar figure.
    """
    if not segments:
        return (_MIN_BILLED_SECS, 0.0 if cost_per_second_usd <= 0 else _MIN_BILLED_SECS * cost_per_second_usd)
    span = max(seg["end"] for seg in segments) - min(seg["start"] for seg in segments)
    billed = max(_MIN_BILLED_SECS, span)
    cost = billed * cost_per_second_usd if cost_per_second_usd > 0 else 0.0
    return (billed, cost)


def diarize_via_cloud(
    audio_path: str,
    *,
    api_key: str,
    base_url: str,
    model: str,
    cost_per_second_usd: float,
) -> tuple[list[dict], float, float]:
    """Orchestrate upload → submit → poll → extract.

    Returns ``(segments, billed_secs, estimated_cost_usd)`` where segments
    use Podlog's internal shape ``{"speaker": "SPEAKER_00", "start": float, "end": float}``.
    """
    if not api_key:
        raise PyannoteCloudError(
            "pyannote cloud provider selected but pyannote_api_key is not set",
            error_class="HTTP_ACCESS",
            retryable=False,
        )
    media_url = upload_audio(audio_path, api_key=api_key, base_url=base_url)
    job_id = submit_diarization(media_url, api_key=api_key, base_url=base_url, model=model)
    payload = poll_job(job_id, api_key=api_key, base_url=base_url)
    segments = _extract_segments(payload)
    billed_secs, cost_usd = _compute_cost(segments, cost_per_second_usd)
    logger.info(
        '"action": "pyannote_cloud_diarize_complete", "job_id": "%s", "segments": %d, '
        '"speakers": %d, "billed_secs": %.1f, "cost_usd": %.4f',
        job_id,
        len(segments),
        len({s["speaker"] for s in segments}),
        billed_secs,
        cost_usd,
    )
    return (segments, billed_secs, cost_usd)


def _normalize_speaker(raw_speaker: str) -> str:
    clean = raw_speaker.strip().replace("-", "_").upper()
    if clean.startswith("SPEAKER_"):
        return clean
    if clean.isdigit():
        return f"SPEAKER_{int(clean):02d}"
    if clean.startswith("SPEAKER") and clean[7:].isdigit():
        return f"SPEAKER_{int(clean[7:]):02d}"
    return f"SPEAKER_{clean}"
