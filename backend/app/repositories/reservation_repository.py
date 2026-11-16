from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, selectinload

from app.models.restaurant import Reservation
from app.repositories.base import paginate_scalars
from app.repositories.table_repository import ACTIVE_RESERVATION_STATUSES


class ReservationRepository:
    """Acceso a datos para reservas de mesas."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, reservation_id: UUID) -> Reservation | None:
        stmt = (
            select(Reservation)
            .options(selectinload(Reservation.table))
            .where(Reservation.id == reservation_id)
        )
        return self.db.scalar(stmt)

    def has_overlapping_reservation(
        self,
        *,
        table_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_reservation_id: UUID | None = None,
    ) -> bool:
        stmt = select(Reservation.id).where(
            and_(
                Reservation.table_id == table_id,
                Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
                Reservation.start_time < end_time,
                Reservation.end_time > start_time,
            )
        )
        if exclude_reservation_id is not None:
            stmt = stmt.where(Reservation.id != exclude_reservation_id)
        return self.db.scalar(stmt.limit(1)) is not None

    def list_reservations(
        self,
        *,
        user_id: UUID | None = None,
        status: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Reservation], int]:
        stmt = (
            select(Reservation)
            .options(selectinload(Reservation.table))
            .order_by(Reservation.start_time.asc())
        )
        if user_id is not None:
            stmt = stmt.where(Reservation.user_id == user_id)
        if status is not None:
            stmt = stmt.where(Reservation.status == status)
        if from_date is not None:
            stmt = stmt.where(Reservation.end_time >= from_date)
        if to_date is not None:
            stmt = stmt.where(Reservation.start_time <= to_date)
        return paginate_scalars(self.db, stmt, limit=limit, offset=offset)

    def create(self, reservation: Reservation) -> Reservation:
        self.db.add(reservation)
        self.db.flush()
        self.db.refresh(reservation)
        return reservation
