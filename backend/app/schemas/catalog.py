from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import ORMBaseSchema


class CategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    slug: str = Field(min_length=2, max_length=110, pattern=r"^[a-z0-9-]+$")
    description: str | None = Field(default=None, max_length=255)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    slug: str | None = Field(default=None, min_length=2, max_length=110, pattern=r"^[a-z0-9-]+$")
    description: str | None = Field(default=None, max_length=255)
    display_order: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class CategoryResponse(ORMBaseSchema):
    id: int
    name: str
    slug: str
    description: str | None
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProductCreate(BaseModel):
    category_id: int = Field(gt=0)
    name: str = Field(min_length=2, max_length=140)
    sku: str = Field(min_length=2, max_length=40)
    description: str | None = None
    price: Decimal = Field(ge=0, decimal_places=2)
    preparation_minutes: int = Field(default=15, ge=0, le=300)
    is_available: bool = True
    is_active: bool = True


class ProductUpdate(BaseModel):
    category_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=2, max_length=140)
    sku: str | None = Field(default=None, min_length=2, max_length=40)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    preparation_minutes: int | None = Field(default=None, ge=0, le=300)
    is_available: bool | None = None
    is_active: bool | None = None


class ProductResponse(ORMBaseSchema):
    id: int
    category_id: int
    name: str
    sku: str
    description: str | None
    price: Decimal
    preparation_minutes: int
    is_available: bool
    is_active: bool
    category: CategoryResponse
    created_at: datetime
    updated_at: datetime
