from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_current_user, get_reservation_service
from app.models.auth import User
from app.schemas.common import PaginatedResponse
from app.schemas.reservations import (
    ReservationCreate,
    ReservationResponse,
    ReservationStatusUpdate,
)
from app.services.reservation_service import ReservationService

router = APIRouter(prefix="/reservations", tags=["Reservas"])


@router.get("", response_model=PaginatedResponse[ReservationResponse])
def list_reservations(
    status_filter: str | None = Query(default=None, alias="status"),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: User = Depends(get_current_user),
    reservation_service: ReservationService = Depends(get_reservation_service),
) -> PaginatedResponse[ReservationResponse]:
    items, total = reservation_service.list_reservations(
        actor=actor,
        status=status_filter,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=ReservationResponse, status_code=status.HTTP_201_CREATED)
def create_reservation(
    payload: ReservationCreate,
    actor: User = Depends(get_current_user),
    reservation_service: ReservationService = Depends(get_reservation_service),
) -> ReservationResponse:
    return reservation_service.create_reservation(payload, actor)


@router.get("/{reservation_id}", response_model=ReservationResponse)
def get_reservation(
    reservation_id: UUID,
    actor: User = Depends(get_current_user),
    reservation_service: ReservationService = Depends(get_reservation_service),
) -> ReservationResponse:
    return reservation_service.get_reservation(reservation_id, actor)


@router.patch("/{reservation_id}/status", response_model=ReservationResponse)
def update_reservation_status(
    reservation_id: UUID,
    payload: ReservationStatusUpdate,
    actor: User = Depends(get_current_user),
    reservation_service: ReservationService = Depends(get_reservation_service),
) -> ReservationResponse:
    return reservation_service.update_status(reservation_id, payload.status, actor)
