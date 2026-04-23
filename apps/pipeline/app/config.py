from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Inference provider routing (Issue #222)
    inference_provider: Literal["local", "fireworks"] = "local"
    fireworks_api_key: str | None = None
    fireworks_audio_base_url: str = "https://audio-turbo.api.fireworks.ai"
    fireworks_stt_model: str = "whisper-v3-turbo"
    fireworks_stt_diarize: bool = True
    fireworks_chat_base_url: str = "https://api.fireworks.ai/inference/v1"
    fireworks_chat_model: str = "accounts/fireworks/models/llama-v3p1-8b-instruct"
    # Cost estimate input for observability (Issue #261).
    # Keep this explicit because provider pricing can change.
    fireworks_stt_cost_per_minute_usd: float = 0.006

    # Embedding provider routing (Issue #258)
    embedding_provider: Literal["local", "fireworks"] = "local"
    embedding_model: str = "all-MiniLM-L6-v2"
    fireworks_embedding_base_url: str = "https://api.fireworks.ai/inference/v1"
    fireworks_embedding_model: str = "BAAI/bge-small-en-v1.5"

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
