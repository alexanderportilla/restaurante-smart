from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración centralizada de la aplicación leída desde variables de entorno."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    APP_ENV: str = "development"
    APP_NAME: str = "Restaurante Smart API"
    API_V1_PREFIX: str = "/api/v1"

    APP_DB_HOST: str = "postgres-app"
    APP_DB_PORT: int = 5432
    APP_DB_NAME: str = "restaurante_smart"
    APP_DB_USER: str = "restaurante_user"
    APP_DB_PASSWORD: str = ""
    DATABASE_URL: str | None = None

    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60, ge=5, le=1440)

    CORS_ORIGINS: str = "http://localhost:3000"
    TAX_RATE: float = Field(default=0.12, ge=0.0, le=0.5)

    @field_validator("API_V1_PREFIX")
    @classmethod
    def ensure_leading_slash(cls, value: str) -> str:
        return value if value.startswith("/") else f"/{value}"

    @computed_field
    @property
    def sqlalchemy_database_url(self) -> str:
        """Devuelve la URL de conexión SQLAlchemy para PostgreSQL."""
        if self.DATABASE_URL:
            return self.DATABASE_URL
        user = quote_plus(self.APP_DB_USER)
        password = quote_plus(self.APP_DB_PASSWORD)
        return (
            f"postgresql+psycopg://{user}:{password}"
            f"@{self.APP_DB_HOST}:{self.APP_DB_PORT}/{self.APP_DB_NAME}"
        )

    @computed_field
    @property
    def cors_origins_list(self) -> list[str]:
        """Lista normalizada de orígenes CORS permitidos."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    def validate_runtime_security(self) -> None:
        """Valida que los secretos críticos no usen valores de plantilla inseguros."""
        if not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY.startswith("CHANGE_ME_"):
            raise RuntimeError(
                "JWT_SECRET_KEY no configurado o usando valor de plantilla inseguro."
            )
        if len(self.JWT_SECRET_KEY) < 32:
            raise RuntimeError("JWT_SECRET_KEY debe tener al menos 32 caracteres.")


@lru_cache
def get_settings() -> Settings:
    """Retorna la instancia en caché de configuración."""
    return Settings()
