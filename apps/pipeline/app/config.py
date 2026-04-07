from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # HuggingFace
    hf_token: str

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
    spacy_model: str = "en_core_web_lg"

    # Inference provider routing (Issue #222)
    inference_provider: Literal["local", "fireworks"] = "local"
    fireworks_api_key: str | None = None
    fireworks_audio_base_url: str = "https://audio-turbo.api.fireworks.ai"
    fireworks_stt_model: str = "whisper-v3-large"
    fireworks_stt_diarize: bool = True

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
