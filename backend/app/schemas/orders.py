from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMBaseSchema

OrderType = Literal["dine_in", "takeaway", "delivery"]


class OrderStatusResponse(ORMBaseSchema):
    id: int
    code: str
    name: str
    sort_order: int
    is_terminal: bool


class OrderItemCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=100)
    special_instructions: str | None = Field(default=None, max_length=255)


class OrderItemResponse(ORMBaseSchema):
    id: int
    product_id: int
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    special_instructions: str | None
    product_name: str | None = None


class OrderCreate(BaseModel):
    order_type: OrderType = "takeaway"
    table_id: int | None = Field(default=None, gt=0)
    reservation_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=1000)
    items: list[OrderItemCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_products(self) -> "OrderCreate":
        seen: set[int] = set()
        for item in self.items:
            if item.product_id in seen:
                raise ValueError(
                    "No se permiten productos duplicados en el mismo pedido; "
                    "ajusta la cantidad del ítem."
                )
            seen.add(item.product_id)
        return self


class OrderStatusUpdate(BaseModel):
    status_code: str = Field(min_length=2, max_length=30)


class OrderResponse(ORMBaseSchema):
    id: UUID
    order_number: str
    user_id: UUID | None
    table_id: int | None
    reservation_id: UUID | None
    order_type: str
    subtotal: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    notes: str | None
    confirmed_at: datetime | None
    status: OrderStatusResponse
    items: list[OrderItemResponse]
    created_at: datetime
    updated_at: datetime
