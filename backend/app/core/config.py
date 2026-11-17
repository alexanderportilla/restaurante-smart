from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})


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

    AUTH_LOGIN_RATE_LIMIT: int = Field(default=10, ge=1, le=1000)
    AUTH_LOGIN_RATE_WINDOW_SECONDS: int = Field(default=60, ge=1, le=3600)
    AUTH_REGISTER_RATE_LIMIT: int = Field(default=5, ge=1, le=1000)
    AUTH_REGISTER_RATE_WINDOW_SECONDS: int = Field(default=300, ge=1, le=86400)
    TRUSTED_PROXY_IPS: str = "127.0.0.1,::1"

    CORS_ORIGINS: str = "http://localhost:3000"
    TAX_RATE: float = Field(default=0.12, ge=0.0, le=0.5)

    @field_validator("API_V1_PREFIX")
    @classmethod
    def ensure_leading_slash(cls, value: str) -> str:
        return value if value.startswith("/") else f"/{value}"

    @field_validator("JWT_ALGORITHM")
    @classmethod
    def validate_jwt_algorithm(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in ALLOWED_JWT_ALGORITHMS:
            allowed = ", ".join(sorted(ALLOWED_JWT_ALGORITHMS))
            raise ValueError(
                f"JWT_ALGORITHM '{value}' no permitido. Algoritmos válidos: {allowed}."
            )
        return normalized

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
        """Valida que los secretos críticos y algoritmos JWT cumplan política segura."""
        if self.JWT_ALGORITHM not in ALLOWED_JWT_ALGORITHMS:
            raise RuntimeError("JWT_ALGORITHM no permitido por la política de seguridad.")
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
