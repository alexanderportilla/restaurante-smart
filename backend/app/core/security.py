from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.exceptions import UnauthorizedError

password_hasher = PasswordHash.recommended()


def hash_password(plain_password: str) -> str:
    """Genera un hash Argon2id seguro para la contraseña."""
    return password_hasher.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verifica una contraseña contra su hash almacenado."""
    return password_hasher.verify(plain_password, password_hash)


def create_access_token(
    subject: UUID | str,
    role: str,
    expires_delta: timedelta | None = None,
) -> str:
    """Firma un token JWT de acceso con expiración explícita en UTC."""
    settings = get_settings()
    settings.validate_runtime_security()

    now = datetime.now(UTC)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Valida algoritmo permitido, firma y vigencia de un JWT y devuelve sus claims."""
    settings = get_settings()
    settings.validate_runtime_security()

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["sub", "exp", "role", "type"]},
        )
    except InvalidTokenError as exc:
        raise UnauthorizedError("Token inválido o expirado.") from exc

    if payload.get("type") != "access":
        raise UnauthorizedError("Tipo de token no válido.")
    return payload
