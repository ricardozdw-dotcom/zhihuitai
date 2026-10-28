from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://zhihuitai:zhihuitai@127.0.0.1:5432/zhihuitai"
    redis_url: str = "redis://127.0.0.1:6379/0"
    blob_dir: str = "./data/blobs"
    ingest_inline: bool = True
    embedding_dim: int = 1024
    cors_origins: str = "http://127.0.0.1:43123,http://localhost:43123,http://127.0.0.1:43125"

    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "qwen-plus"
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    rerank_base_url: str = ""
    rerank_api_key: str = ""
    rerank_model: str = ""

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key.strip() and self.llm_base_url.strip())

    @property
    def embedding_configured(self) -> bool:
        return bool(self.embedding_api_key.strip() and self.embedding_base_url.strip())

    @property
    def rerank_configured(self) -> bool:
        return bool(self.rerank_api_key.strip() and self.rerank_base_url.strip())

    @property
    def embedding_label(self) -> str:
        if self.embedding_configured:
            return f"{self.embedding_model} · {self.embedding_dim}d"
        return f"deterministic-hash · {self.embedding_dim}d"


@lru_cache
def get_settings() -> Settings:
    return Settings()
