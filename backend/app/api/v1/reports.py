from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_report_service, require_roles
from app.models.auth import User
from app.schemas.reports import ReportSummaryResponse, TopProductsResponse
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reportes"])


@router.get("/summary", response_model=ReportSummaryResponse)
def get_summary_report(
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    _actor: User = Depends(require_roles("admin", "manager")),
    report_service: ReportService = Depends(get_report_service),
) -> ReportSummaryResponse:
    return report_service.get_summary(from_date=from_date, to_date=to_date)


@router.get("/top-products", response_model=TopProductsResponse)
def get_top_products_report(
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    _actor: User = Depends(require_roles("admin", "manager")),
    report_service: ReportService = Depends(get_report_service),
) -> TopProductsResponse:
    return report_service.get_top_products(from_date=from_date, to_date=to_date, limit=limit)
