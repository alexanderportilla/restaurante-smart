from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMBaseSchema


class TableCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=2, max_length=80)
    capacity: int = Field(gt=0, le=50)
    location: str = Field(default="Salón principal", min_length=2, max_length=80)
    is_active: bool = True


class TableUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=20)
    name: str | None = Field(default=None, min_length=2, max_length=80)
    capacity: int | None = Field(default=None, gt=0, le=50)
    location: str | None = Field(default=None, min_length=2, max_length=80)
    is_active: bool | None = None


class TableResponse(ORMBaseSchema):
    id: int
    code: str
    name: str
    capacity: int
    location: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AvailabilityResponse(BaseModel):
    start_time: datetime
    end_time: datetime
    party_size: int
    available_tables: list[TableResponse]
