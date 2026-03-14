from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # Redis / Celery
    redis_url: str = "redis://redis:6379/0"
    celery_concurrency: int = 1

    # HuggingFace
    hf_token: str

    # Whisper
    whisper_model: str = "large-v3-turbo"

    # Storage
    data_dir: str = "/data"
    archive_audio: bool = True
    audio_archive_bitrate: str = "64k"

    # Feed polling
    feed_poll_interval_hours: int = 24

    # Retry configuration
    retry_max: int = 3
    retry_backoff_base: int = 30  # seconds; actual = base * 2^(attempt-1) → 30s, 60s, 120s

    # Disk space guard (GAP-06): minimum free bytes before starting a download
    disk_headroom_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB

    # Host/guest inference (PRD-04 §9)
    inference_enabled: bool = True
    spacy_model: str = "en_core_web_trf"

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
