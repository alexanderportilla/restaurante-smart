from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMBaseSchema


class RegisterRequest(BaseModel):
    """Registro de nuevo cliente."""

    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    """Credenciales de inicio de sesión."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class CurrentUserResponse(ORMBaseSchema):
    """Información del usuario autenticado y sus permisos efectivos."""

    id: UUID
    full_name: str
    email: EmailStr
    phone: str | None
    is_active: bool
    role_code: str
    role_name: str
    permissions: list[str]


class TokenResponse(BaseModel):
    """Token JWT emitido tras autenticación exitosa."""

    access_token: str
    token_type: str = Field(default="bearer")
    expires_in: int
    user: CurrentUserResponse
