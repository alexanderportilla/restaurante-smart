from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.schemas.common import ORMBaseSchema
from app.schemas.tables import TableResponse

ReservationStatusType = Literal["pending", "confirmed", "completed", "cancelled", "no_show"]


class ReservationCreate(BaseModel):
    table_id: int = Field(gt=0)
    customer_name: str = Field(min_length=2, max_length=120)
    customer_email: EmailStr
    customer_phone: str = Field(min_length=5, max_length=30)
    party_size: int = Field(gt=0, le=50)
    start_time: datetime
    end_time: datetime
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_time_range(self) -> "ReservationCreate":
        if self.start_time.tzinfo is None or self.end_time.tzinfo is None:
            raise ValueError("Las fechas deben incluir zona horaria (UTC/ISO 8601).")
        if self.end_time <= self.start_time:
            raise ValueError("La hora de fin debe ser posterior a la hora de inicio.")
        return self


class ReservationStatusUpdate(BaseModel):
    status: ReservationStatusType


class ReservationResponse(ORMBaseSchema):
    id: UUID
    user_id: UUID | None
    table_id: int
    customer_name: str
    customer_email: EmailStr
    customer_phone: str
    party_size: int
    start_time: datetime
    end_time: datetime
    status: str
    confirmation_code: str
    notes: str | None
    table: TableResponse
    created_at: datetime
    updated_at: datetime
