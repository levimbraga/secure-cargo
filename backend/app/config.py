"""Runtime configuration, read from environment variables (prefix ``SECURECARGO_``)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SECURECARGO_", env_file=".env", extra="ignore")

    # Comma-separated list of origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:3000,https://securecargo.app,https://www.securecargo.app"

    # Storage backend. Only ``sqlite:///<path>`` and ``memory://`` exist today; a hosted
    # database gets its own scheme later (container disks are ephemeral).
    storage_url: str = "sqlite:///./data/securecargo.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
