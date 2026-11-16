from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMBaseSchema


class PermissionResponse(ORMBaseSchema):
    id: int
    code: str
    description: str | None


class RoleResponse(ORMBaseSchema):
    id: int
    code: str
    name: str
    description: str | None
    permissions: list[PermissionResponse] = []


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)
    password: str = Field(min_length=8, max_length=128)
    role_code: str = Field(min_length=2, max_length=40)
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    role_code: str | None = Field(default=None, min_length=2, max_length=40)
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserResponse(ORMBaseSchema):
    id: UUID
    full_name: str
    email: EmailStr
    phone: str | None
    is_active: bool
    role: RoleResponse
    created_at: datetime
    updated_at: datetime
