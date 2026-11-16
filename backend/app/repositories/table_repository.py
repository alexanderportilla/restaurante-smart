from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.restaurant import Reservation, RestaurantTable

ACTIVE_RESERVATION_STATUSES = ("pending", "confirmed")


class TableRepository:
    """Acceso a datos para mesas físicas y consulta de disponibilidad."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_tables(self, *, only_active: bool = False) -> list[RestaurantTable]:
        stmt = select(RestaurantTable).order_by(RestaurantTable.code.asc())
        if only_active:
            stmt = stmt.where(RestaurantTable.is_active.is_(True))
        return list(self.db.scalars(stmt).all())

    def get_by_id(self, table_id: int) -> RestaurantTable | None:
        return self.db.get(RestaurantTable, table_id)

    def lock_by_id(self, table_id: int) -> RestaurantTable | None:
        """Bloquea la fila de la mesa en PostgreSQL durante una transacción crítica."""
        stmt = select(RestaurantTable).where(RestaurantTable.id == table_id).with_for_update()
        return self.db.scalar(stmt)

    def get_by_code(self, code: str) -> RestaurantTable | None:
        return self.db.scalar(select(RestaurantTable).where(RestaurantTable.code == code))

    def create(self, table: RestaurantTable) -> RestaurantTable:
        self.db.add(table)
        self.db.flush()
        self.db.refresh(table)
        return table

    def find_available_tables(
        self,
        *,
        start_time: datetime,
        end_time: datetime,
        party_size: int,
    ) -> list[RestaurantTable]:
        """Obtiene mesas activas con capacidad suficiente y sin reservas activas solapadas."""
        overlapping_table_ids = select(Reservation.table_id).where(
            and_(
                Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
                Reservation.start_time < end_time,
                Reservation.end_time > start_time,
            )
        )
        stmt = (
            select(RestaurantTable)
            .where(
                and_(
                    RestaurantTable.is_active.is_(True),
                    RestaurantTable.capacity >= party_size,
                    RestaurantTable.id.not_in(overlapping_table_ids),
                )
            )
            .order_by(RestaurantTable.capacity.asc(), RestaurantTable.code.asc())
        )
        return list(self.db.scalars(stmt).all())
