from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_table_service
from app.schemas.tables import AvailabilityResponse
from app.services.table_service import TableService

router = APIRouter(prefix="/availability", tags=["Disponibilidad"])


@router.get("", response_model=AvailabilityResponse)
def check_availability(
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    party_size: int = Query(..., gt=0, le=50),
    table_service: TableService = Depends(get_table_service),
) -> AvailabilityResponse:
    tables = table_service.check_availability(
        start_time=start_time,
        end_time=end_time,
        party_size=party_size,
    )
    return AvailabilityResponse(
        start_time=start_time,
        end_time=end_time,
        party_size=party_size,
        available_tables=tables,
    )
