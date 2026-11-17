from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.exceptions import UnauthorizedError, register_exception_handlers
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.main import create_app


def test_argon2_hash_and_verify() -> None:
    raw = "ClaveSegura2026!"
    h1 = hash_password(raw)
    h2 = hash_password(raw)

    assert h1 != raw
    assert h1 != h2
    assert h1.startswith("$argon2")
    assert verify_password(raw, h1) is True
    assert verify_password("Incorrecta!", h1) is False


def test_jwt_create_decode_and_reject_invalid() -> None:
    uid = uuid4()
    token = create_access_token(uid, "manager")
    payload = decode_access_token(token)

    assert payload["sub"] == str(uid)
    assert payload["role"] == "manager"
    assert payload["type"] == "access"

    with pytest.raises(UnauthorizedError):
        decode_access_token(token + "tampered")

    expired = create_access_token(uid, "manager", expires_delta=timedelta(seconds=-10))
    with pytest.raises(UnauthorizedError):
        decode_access_token(expired)


def test_settings_validation_and_database_url() -> None:
    settings = Settings(
        APP_DB_USER="restaurante_user",
        APP_DB_PASSWORD="p@ss:word/special",
        APP_DB_HOST="postgres-app",
        APP_DB_PORT=5432,
        APP_DB_NAME="restaurante_smart",
        JWT_SECRET_KEY="a" * 32,
        CORS_ORIGINS="http://localhost:3000, https://smart.local",
    )
    assert (
        settings.sqlalchemy_database_url
        == "postgresql+psycopg://restaurante_user:p%40ss%3Aword%2Fspecial@postgres-app:5432/restaurante_smart"
    )
    assert settings.cors_origins_list == ["http://localhost:3000", "https://smart.local"]
    settings.validate_runtime_security()

    with pytest.raises(RuntimeError):
        Settings(JWT_SECRET_KEY="CHANGE_ME_SECRET").validate_runtime_security()

    with pytest.raises(RuntimeError):
        Settings(JWT_SECRET_KEY="short").validate_runtime_security()


def test_centralized_exception_handlers_hide_internal_errors() -> None:
    mini_app = FastAPI()
    register_exception_handlers(mini_app)

    @mini_app.get("/boom")
    def boom() -> None:
        raise RuntimeError("Falla interna sensible")

    client = TestClient(mini_app, raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    body = res.json()
    assert body["error"]["code"] == "INTERNAL_SERVER_ERROR"
    assert "sensible" not in body["error"]["message"]


def test_fastapi_startup_validates_jwt_security(monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        # 1. Entorno normal con clave insegura impide iniciar FastAPI
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("JWT_SECRET_KEY", "CHANGE_ME_GENERATE_RANDOM_64_HEX_SECRET")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"), TestClient(create_app()):
            pass

        # 2. Entorno normal con clave corta impide iniciar FastAPI
        monkeypatch.setenv("JWT_SECRET_KEY", "demasiado-corta")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"), TestClient(create_app()):
            pass

        # 3. Entorno normal con clave válida permite iniciar la aplicación
        monkeypatch.setenv("JWT_SECRET_KEY", "x" * 64)
        get_settings.cache_clear()
        with TestClient(create_app()) as client:
            assert client.app.title == "Restaurante Smart API"

        # 4. Entorno test con configuración explícita permite ejecutar pruebas
        monkeypatch.setenv("APP_ENV", "test")
        monkeypatch.setenv(
            "JWT_SECRET_KEY",
            "test-only-jwt-secret-key-with-minimum-32-chars-restaurante-smart",
        )
        get_settings.cache_clear()
        with TestClient(create_app()) as client:
            assert client.app.version == "1.0.0"
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
