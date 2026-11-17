#!/usr/bin/env python3
"""Inicia un backend FastAPI efímero en loopback conectado exclusivamente a restaurante_smart_test."""

import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
SECRET_PATH = pathlib.Path("/home/alexpc/.local/share/restaurante-smart-test/postgres_test_password")

sys.path.insert(0, str(BACKEND_DIR))

from tests.conftest import require_isolated_test_database_url  # noqa: E402


def main() -> None:
    if not SECRET_PATH.is_file():
        raise SystemExit(
            "ERROR: No existe el archivo de contraseña temporal para restaurante_smart_test."
        )

    password = SECRET_PATH.read_text(encoding="utf-8").strip()
    raw_url = (
        f"postgresql+psycopg://restaurante_test_user:{password}"
        "@127.0.0.1:5433/restaurante_smart_test"
    )
    validated_url = require_isolated_test_database_url("1", raw_url)

    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = validated_url
    os.environ["JWT_SECRET_KEY"] = "e2e-test-only-jwt-secret-key-with-minimum-32-chars-restaurante"
    os.environ["APP_DB_PASSWORD"] = "e2e-test-only-db-password"
    os.environ["CORS_ORIGINS"] = "http://127.0.0.1:13000,http://localhost:13000"
    os.environ["AUTH_LOGIN_RATE_LIMIT"] = "200"
    os.environ["AUTH_REGISTER_RATE_LIMIT"] = "200"

    os.chdir(BACKEND_DIR)
    uvicorn_bin = BACKEND_DIR / ".venv" / "bin" / "uvicorn"
    os.execv(
        str(uvicorn_bin),
        [
            str(uvicorn_bin),
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "18000",
        ],
    )


if __name__ == "__main__":
    main()
