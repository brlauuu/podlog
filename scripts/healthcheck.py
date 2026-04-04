#!/usr/bin/env python3
"""
Podlog system health monitor — runs via host cron every 15 minutes.

Checks:
  1. PostgreSQL (pg_isready)
  2. Pipeline API (GET /api/health)
  3. Web app (HTTP check on :3000)
  4. Worker (docker compose ps)
  5. Zombie jobs (picked_at older than threshold)

Sends Telegram alerts only on state transitions (up->down, down->up) to
avoid alert fatigue. Telegram credentials are resolved with the same
priority as the rest of Podlog: .env values override DB (UI) values.

Requires: python3, docker, pg_isready (from postgresql-client), curl.
"""
import json
import logging
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent
ENV_FILE = REPO_DIR / ".env"
STATE_FILE = Path.home() / ".podlog-health-state.json"
COMPOSE_PROJECT_DIR = REPO_DIR  # where docker-compose.yml lives

# Services to check via docker compose ps
DOCKER_SERVICES = ["db", "pipeline", "worker", "web"]

# Defaults (overridden by .env)
DEFAULT_PIPELINE_URL = "http://localhost:8000"
DEFAULT_WEB_URL = "http://localhost:3000"
DEFAULT_DB_HOST = "localhost"
DEFAULT_DB_PORT = "5432"
DEFAULT_DB_USER = "postgres"
DEFAULT_ZOMBIE_THRESHOLD_MINUTES = 60
DEFAULT_HTTP_TIMEOUT = 10  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [healthcheck] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("podlog-healthcheck")


# ---------------------------------------------------------------------------
# .env parsing
# ---------------------------------------------------------------------------

def parse_env_file(path: Path) -> dict[str, str]:
    """Parse a .env file into a dict. Ignores comments and blank lines."""
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        # Strip inline comments (only if preceded by whitespace)
        for i, ch in enumerate(value):
            if ch == "#" and i > 0 and value[i - 1] in (" ", "\t"):
                value = value[:i]
                break
        value = value.strip().strip("'\"")
        env[key] = value
    return env


# ---------------------------------------------------------------------------
# Telegram credentials resolution: .env > DB (UI) > None
# ---------------------------------------------------------------------------

def resolve_telegram_credentials(env: dict[str, str]) -> tuple[str | None, str | None]:
    """Resolve Telegram bot token and chat ID.

    Priority: .env values override DB/UI values. If .env has them, use those.
    Otherwise, try to read from the DB notification_settings JSON blob.
    """
    bot_token = env.get("TELEGRAM_BOT_TOKEN") or None
    chat_id = env.get("TELEGRAM_CHAT_ID") or None

    if bot_token and chat_id:
        return bot_token, chat_id

    # Fall back to DB (UI-configured values)
    db_token, db_chat_id = _read_telegram_from_db(env)
    if not bot_token:
        bot_token = db_token
    if not chat_id:
        chat_id = db_chat_id

    return bot_token, chat_id


def _read_notification_settings_from_db(env: dict[str, str]) -> dict:
    """Read notification_settings JSON blob from system_state table."""
    password = env.get("POSTGRES_PASSWORD", "")
    db_host = env.get("HEALTH_CHECK_DB_HOST", DEFAULT_DB_HOST)
    db_port = env.get("HEALTH_CHECK_DB_PORT", DEFAULT_DB_PORT)
    db_user = env.get("HEALTH_CHECK_DB_USER", DEFAULT_DB_USER)
    db_name = env.get("HEALTH_CHECK_DB_NAME", "podlog")

    try:
        result = subprocess.run(
            [
                "psql",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-t", "-A",
                "-c", "SELECT value FROM system_state WHERE key = 'notification_settings'",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "PGPASSWORD": password},
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {}
        return json.loads(result.stdout.strip())
    except Exception as exc:
        logger.debug("Could not read notification settings from DB: %s", exc)
        return {}


def _read_telegram_from_db(env: dict[str, str]) -> tuple[str | None, str | None]:
    """Read telegram credentials from the system_state table."""
    settings = _read_notification_settings_from_db(env)
    return settings.get("telegram_bot_token"), settings.get("telegram_chat_id")


# ---------------------------------------------------------------------------
# Health checks
# ---------------------------------------------------------------------------

def check_db(env: dict[str, str]) -> tuple[str, str]:
    """Check PostgreSQL via pg_isready. Returns (status, detail)."""
    password = env.get("POSTGRES_PASSWORD", "")
    db_host = env.get("HEALTH_CHECK_DB_HOST", DEFAULT_DB_HOST)
    db_port = env.get("HEALTH_CHECK_DB_PORT", DEFAULT_DB_PORT)
    db_user = env.get("HEALTH_CHECK_DB_USER", DEFAULT_DB_USER)

    try:
        result = subprocess.run(
            ["pg_isready", "-h", db_host, "-p", db_port, "-U", db_user],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "PGPASSWORD": password},
        )
        if result.returncode == 0:
            return "up", "accepting connections"
        return "down", result.stdout.strip() or result.stderr.strip() or "not ready"
    except FileNotFoundError:
        return "down", "pg_isready not found — install postgresql-client"
    except Exception as exc:
        return "down", str(exc)


def check_http(name: str, url: str) -> tuple[str, str]:
    """Check an HTTP endpoint. Returns (status, detail)."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=DEFAULT_HTTP_TIMEOUT) as resp:
            if resp.status < 400:
                return "up", f"HTTP {resp.status}"
            return "down", f"HTTP {resp.status}"
    except Exception as exc:
        return "down", str(exc)


def check_docker_service(service: str) -> tuple[str, str]:
    """Check if a docker compose service is running. Returns (status, detail)."""
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json", service],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=COMPOSE_PROJECT_DIR,
        )
        if result.returncode != 0:
            return "down", result.stderr.strip() or "docker compose ps failed"

        output = result.stdout.strip()
        if not output:
            return "down", "service not found in compose"

        # docker compose ps --format json may return one JSON object per line
        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                info = json.loads(line)
            except json.JSONDecodeError:
                continue
            state = info.get("State", "").lower()
            health = info.get("Health", "").lower()
            if state == "running":
                if health and health != "healthy":
                    return "degraded", f"running but {health}"
                return "up", f"running ({health or 'no healthcheck'})"
            return "down", f"state={state}"

        return "down", "could not parse service status"
    except FileNotFoundError:
        return "down", "docker not found"
    except Exception as exc:
        return "down", str(exc)


def check_zombie_jobs(env: dict[str, str]) -> tuple[str, str]:
    """Check for zombie jobs (picked for too long). Returns (status, detail)."""
    password = env.get("POSTGRES_PASSWORD", "")
    db_host = env.get("HEALTH_CHECK_DB_HOST", DEFAULT_DB_HOST)
    db_port = env.get("HEALTH_CHECK_DB_PORT", DEFAULT_DB_PORT)
    db_user = env.get("HEALTH_CHECK_DB_USER", DEFAULT_DB_USER)
    db_name = env.get("HEALTH_CHECK_DB_NAME", "podlog")
    threshold = int(env.get("HEALTH_CHECK_ZOMBIE_THRESHOLD_MINUTES", DEFAULT_ZOMBIE_THRESHOLD_MINUTES))

    query = (
        "SELECT jq.id, jq.task, jq.picked_at, e.title AS episode_title, "
        "EXTRACT(EPOCH FROM (NOW() - jq.picked_at)) / 60 AS stuck_minutes "
        "FROM job_queue jq "
        "LEFT JOIN episodes e ON e.id = jq.episode_id "
        f"WHERE jq.status = 'picked' AND jq.picked_at < NOW() - INTERVAL '{threshold} minutes' "
        "ORDER BY jq.picked_at ASC"
    )

    try:
        result = subprocess.run(
            [
                "psql",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-t", "-A", "-F", "|",
                "-c", query,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "PGPASSWORD": password},
        )
        if result.returncode != 0:
            return "unknown", f"query failed: {result.stderr.strip()}"

        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        if not lines:
            return "clear", "no zombie jobs"

        zombies = []
        for line in lines:
            parts = line.split("|")
            job_id = parts[0] if len(parts) > 0 else "?"
            task = parts[1] if len(parts) > 1 else "?"
            picked_at = parts[2] if len(parts) > 2 else "?"
            episode = parts[3] if len(parts) > 3 else "unknown"
            stuck_mins = float(parts[4]) if len(parts) > 4 else 0
            zombies.append({
                "job_id": job_id,
                "task": task,
                "picked_at": picked_at,
                "episode": episode.strip() or "untitled",
                "stuck_minutes": stuck_mins,
            })

        return "zombies", zombies
    except FileNotFoundError:
        return "unknown", "psql not found — install postgresql-client"
    except Exception as exc:
        return "unknown", str(exc)


# ---------------------------------------------------------------------------
# State tracking — only alert on transitions
# ---------------------------------------------------------------------------

def load_state() -> dict:
    """Load previous health state from disk."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_state(state: dict) -> None:
    """Persist health state to disk."""
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Telegram alerting
# ---------------------------------------------------------------------------

def send_telegram(bot_token: str, chat_id: str, message: str) -> bool:
    """Send a Telegram message. Returns True on success."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": message,
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as exc:
        logger.error("Telegram send failed: %s", exc)
        return False


def _fmt_duration(minutes: float) -> str:
    """Format a duration in minutes to a human-readable string."""
    if minutes < 60:
        return f"{int(minutes)}m"
    hours = int(minutes // 60)
    mins = int(minutes % 60)
    return f"{hours}h {mins}m" if mins else f"{hours}h"


def _format_zombie_section(zombies: list[dict]) -> list[str]:
    """Format zombie job details into clear, scannable lines."""
    lines = []
    lines.append(f"ZOMBIE JOBS: {len(zombies)} stuck")
    lines.append("")
    lines.append(
        "A zombie job has been running far longer than expected. "
        "It is likely stuck or the worker process crashed."
    )
    lines.append("")

    for z in zombies:
        stuck = _fmt_duration(z["stuck_minutes"])
        lines.append(f"  Job #{z['job_id']}  {z['task'].upper()}")
        lines.append(f"    Episode: {z['episode']}")
        lines.append(f"    Stuck for: {stuck} (picked at {z['picked_at']})")
        lines.append("")

    lines.append("Next steps:")
    lines.append("  1. Check worker logs: docker compose logs worker --tail 100")
    lines.append("  2. Check the queue page in the Podlog UI")
    lines.append("  3. If the worker is unresponsive, restart it:")
    lines.append("     docker compose restart worker")

    return lines


def format_alert(transitions: list[tuple[str, str, str, object]], timestamp: str) -> str:
    """Format state transitions into a Telegram message.

    Each transition is (service, old_status, new_status, detail).
    detail is a string for most services, or a list of dicts for zombie_jobs.
    """
    lines = [f"PODLOG HEALTH ALERT\n{timestamp}\n"]

    downs = [t for t in transitions if t[2] in ("down", "degraded", "zombies")]
    ups = [t for t in transitions if t[2] in ("up", "clear")]

    if downs:
        for service, old_st, new_st, detail in downs:
            if new_st == "zombies" and isinstance(detail, list):
                lines.extend(_format_zombie_section(detail))
            elif new_st == "zombies":
                # Fallback for string detail (shouldn't happen but be safe)
                lines.append(f"  {service}: {detail}")
            else:
                icon = "DEGRADED" if new_st == "degraded" else "DOWN"
                lines.append(f"  {service}: {icon} -- {detail}")

    if ups:
        if downs:
            lines.append("")
        for service, old_st, new_st, detail in ups:
            if service == "zombie_jobs":
                lines.append(f"  zombie_jobs: CLEARED (all stuck jobs resolved)")
            else:
                lines.append(f"  {service}: RECOVERED")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_checks(env: dict[str, str]) -> dict[str, tuple[str, str]]:
    """Run all health checks. Returns {service: (status, detail)}."""
    results = {}

    # 1. Database via pg_isready
    results["db"] = check_db(env)

    # 2. Pipeline API
    pipeline_url = env.get("HEALTH_CHECK_PIPELINE_URL", DEFAULT_PIPELINE_URL)
    results["pipeline"] = check_http("pipeline", f"{pipeline_url}/api/health")

    # 3. Web app
    web_url = env.get("HEALTH_CHECK_WEB_URL", DEFAULT_WEB_URL)
    results["web"] = check_http("web", web_url)

    # 4. Worker via docker compose ps
    results["worker"] = check_docker_service("worker")

    # 5. Zombie jobs
    results["zombie_jobs"] = check_zombie_jobs(env)

    return results


def is_health_check_enabled(env: dict[str, str]) -> bool:
    """Check if health check notifications are enabled.

    Priority: .env value > DB setting > True (default on).
    """
    env_val = env.get("HEALTH_CHECK_NOTIFICATIONS_ENABLED")
    if env_val is not None:
        return env_val.lower() not in ("false", "0", "no")

    db_settings = _read_notification_settings_from_db(env)
    db_val = db_settings.get("health_check_notifications_enabled")
    if db_val is not None:
        return bool(db_val)

    return True  # enabled by default


def main() -> None:
    env = parse_env_file(ENV_FILE)

    if not is_health_check_enabled(env):
        logger.info("Health check notifications disabled via settings — exiting")
        return

    bot_token, chat_id = resolve_telegram_credentials(env)

    if not bot_token or not chat_id:
        logger.error(
            "Telegram credentials not found in .env or DB. "
            "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env or configure via the UI."
        )
        sys.exit(1)

    results = run_checks(env)
    prev_state = load_state()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    transitions = []
    new_state = {}

    for service, (status, detail) in results.items():
        new_state[service] = status
        old_status = prev_state.get(service)

        # Normalize: treat None (first run) as "up"/"clear" so we don't alert on startup
        if old_status is None:
            if status in ("up", "clear"):
                continue  # no transition, all good
            # First run and service is already down — alert
            transitions.append((service, "unknown", status, detail))
        elif old_status != status:
            transitions.append((service, old_status, status, detail))

    save_state(new_state)

    # Log current state
    for service, (status, detail) in results.items():
        logger.info("%s: %s (%s)", service, status, detail)

    if transitions:
        message = format_alert(transitions, now)
        logger.info("State transitions detected, sending alert")
        send_telegram(bot_token, chat_id, message)
    else:
        logger.info("No state transitions — no alert needed")


if __name__ == "__main__":
    main()
