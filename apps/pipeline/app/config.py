from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_DEFAULT_ASK_SYSTEM_PROMPT = (
    "You are a helpful assistant that answers questions about podcast transcripts.\n"
    "\n"
    "RULES:\n"
    "- Answer ONLY based on the provided transcript excerpts below.\n"
    "- If the excerpts don't contain enough information, say so clearly.\n"
    "- Cite your sources using the format [Episode Title, MM:SS] after each claim.\n"
    "- Format your response using Markdown: use **bold** for emphasis, bullet lists "
    "for multiple points, and headers for distinct sections when appropriate.\n"
    "- Be concise and direct."
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # HuggingFace
    hf_token: str

    # pyannote diarization model (gated on HuggingFace — user must accept license)
    pyannote_model: str = "pyannote/speaker-diarization-community-1"

    # Whisper (WhisperX / CTranslate2 backend)
    whisper_model: str = "large-v3-turbo"
    whisper_compute_type: str = "int8"
    whisper_batch_size: int = 16
    # CPU threads for the CTranslate2 ASR pass. WhisperX defaults this to 4,
    # which pins transcription to 4 cores regardless of machine size (the cause
    # of the ~4-core / 8h-per-episode slowdown). 0 = auto-detect available cores.
    # On hyperthreaded CPUs, setting this to the physical-core count is optimal.
    whisper_cpu_threads: int = 0

    # Storage
    data_dir: str = "/data"
    archive_audio: bool = True
    audio_archive_bitrate: str = "64k"

    # Feed polling
    feed_poll_interval_hours: int = 24

    # Retry configuration
    retry_max: int = 3
    retry_backoff_base: int = 30  # seconds; actual = base * 2^(attempt-1) -> 30s, 60s, 120s

    # Disk space guard (GAP-06): minimum free bytes before starting a download
    disk_headroom_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB

    # Zombie job detection — only jobs that have been picked (actually started)
    # are candidates. Expected runtime = episode.duration_secs × realtime_factor.
    # A job is zombie if it's been running longer than expected × timeout_multiplier.
    zombie_realtime_factor: float = 1.5  # expected processing speed vs audio duration
    zombie_timeout_multiplier: float = 2.0  # zombie after 2× expected runtime
    zombie_min_timeout_minutes: int = 60  # floor when audio duration is unknown

    # Ollama (RAG — issue #115)
    ollama_url: str = "http://ollama:11434"

    # Host/guest inference (PRD-04 S9)
    inference_enabled: bool = True
    # en_core_web_trf is the PRD-04 default (better NER accuracy, ~500 MB).
    # inference.py falls back to en_core_web_lg if trf is not installed.
    spacy_model: str = "en_core_web_trf"
    # Recurring-host rule (PRD-04 §4.2 A1): if the same display name appears
    # as SPEAKER_00 across ≥ threshold * window recent episodes, use it as
    # the host candidate for the current episode. Emitted at MEDIUM so the
    # rule cannot self-reinforce.
    recurring_host_window: int = Field(default=10, ge=1)
    recurring_host_threshold: float = Field(default=0.8, ge=0.0, le=1.0)
    # Per-feed speaker cache recency cutoff (PRD-04 §4.2 C1/C2): cache
    # entries whose last_seen_at is older than this many days are ignored
    # when seeding candidates, so a long-ago confirmation cannot outrank a
    # recent correction. 0 disables the cutoff.
    feed_speaker_cache_recency_days: int = Field(default=365, ge=0)

    # Hardware profile override for cost estimates (Issue #322)
    hardware_profile: str | None = None

    # Default local Ollama model for the Ask / RAG feature (Issue #637).
    # Must match one of the values in apps/web/src/lib/rag-models.ts::RAG_MODELS.
    rag_local_model: str = "qwen2.5:3b"

    # Daily backup retention (#630). Mirrors what the apps/backup
    # service reads via env. Surfaced through /api/backups (#646) so
    # the Settings UI can show "X of N kept" without having to read
    # the env vars itself.
    backup_retention_daily: int = 7
    backup_retention_weekly: int = 4
    backup_retention_monthly: int = 12

    # Local embedding model (#951 allowlist in notification_settings.py)
    embedding_model: str = "all-MiniLM-L6-v2"

    # LLM system prompts (Issue #643). Build-time defaults; the `prompt_settings`
    # table holds optional UI overrides. The "Reset to default" button in the
    # Settings → Prompts tab deletes the override row so the value falls back
    # to whatever the env var is set to here. Both fields default to the same
    # literal so the feature is invisible on upgrade — they're separate so
    # users can let them diverge.
    prompt_ask_page_system: str = _DEFAULT_ASK_SYSTEM_PROMPT
    prompt_ask_episode_system: str = _DEFAULT_ASK_SYSTEM_PROMPT

    # Notifications (all optional — no env vars = no notifications)
    notification_email_to: str | None = None
    notification_email_from: str = "podlog@localhost"
    smtp_host: str = "host.docker.internal"
    smtp_port: int = 25
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = False

    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    # Comma-separated numeric Telegram user ids allowed to talk to the bot
    # (#1034). Empty means the bot is off. See services/telegram_bot.py.
    telegram_allowed_user_ids: str | None = None
    # Where the bot reaches the web app for search (#1035). Full-text search
    # lives in the web app, not here. Compose service name by default;
    # native dev sets http://localhost:3000.
    web_internal_url: str = "http://web:3000"
    # The LAN address `make up` computes on the host (#1012). The bot uses it
    # to build deep links into episode pages; empty means no links.
    podlog_lan_url: str | None = None
    notification_frequency: Literal["immediate", "daily", "weekly"] = "immediate"
    health_check_notifications_enabled: bool = True

    @property
    def email_notifications_enabled(self) -> bool:
        return self.notification_email_to is not None

    @property
    def telegram_notifications_enabled(self) -> bool:
        return self.telegram_bot_token is not None and self.telegram_chat_id is not None

    @property
    def audio_raw_dir(self) -> str:
        return f"{self.data_dir}/audio/raw"

    @property
    def audio_archive_dir(self) -> str:
        return f"{self.data_dir}/audio/archive"

    @property
    def transcript_dir(self) -> str:
        return f"{self.data_dir}/transcripts"

    @property
    def model_cache_dir(self) -> str:
        return "/root/.cache/huggingface"


settings = Settings()  # type: ignore[call-arg]
