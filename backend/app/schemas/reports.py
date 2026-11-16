from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class StatusCountItem(BaseModel):
    status_code: str
    status_name: str
    count: int


class ReportSummaryResponse(BaseModel):
    from_date: datetime | None
    to_date: datetime | None
    total_orders: int
    total_revenue: Decimal
    total_reservations: int
    active_tables: int
    orders_by_status: list[StatusCountItem]


class TopProductReportItem(BaseModel):
    product_id: int
    product_name: str
    sku: str
    total_quantity: int
    total_revenue: Decimal


class TopProductsResponse(BaseModel):
    from_date: datetime | None
    to_date: datetime | None
    items: list[TopProductReportItem]
