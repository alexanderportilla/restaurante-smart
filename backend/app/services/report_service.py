from datetime import datetime

from app.repositories.order_repository import OrderRepository
from app.schemas.reports import ReportSummaryResponse, TopProductsResponse


class ReportService:
    """Servicio de reportes operativos y ventas."""

    def __init__(self, order_repo: OrderRepository) -> None:
        self.order_repo = order_repo

    def get_summary(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> ReportSummaryResponse:
        metrics = self.order_repo.get_summary_metrics(from_date=from_date, to_date=to_date)
        return ReportSummaryResponse(from_date=from_date, to_date=to_date, **metrics)

    def get_top_products(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit: int = 10,
    ) -> TopProductsResponse:
        items = self.order_repo.get_top_products(from_date=from_date, to_date=to_date, limit=limit)
        return TopProductsResponse(from_date=from_date, to_date=to_date, items=items)
