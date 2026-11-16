import secrets
from datetime import datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.core.exceptions import BusinessRuleError, ConflictError, ForbiddenError, NotFoundError
from app.models.auth import User
from app.models.restaurant import Reservation
from app.repositories.reservation_repository import ReservationRepository
from app.repositories.table_repository import TableRepository
from app.schemas.reservations import ReservationCreate
from app.services.notification_service import NotificationService

RESERVATION_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"completed", "cancelled", "no_show"},
    "completed": set(),
    "cancelled": set(),
    "no_show": set(),
}


class ReservationService:
    """Servicio transaccional para reservas con control de concurrencia y confirmaciones."""

    def __init__(
        self,
        reservation_repo: ReservationRepository,
        table_repo: TableRepository,
        notification_service: NotificationService,
    ) -> None:
        self.reservation_repo = reservation_repo
        self.table_repo = table_repo
        self.notification_service = notification_service

    def create_reservation(self, payload: ReservationCreate, actor: User) -> Reservation:
        db = self.reservation_repo.db
        table = self.table_repo.lock_by_id(payload.table_id)
        if table is None:
            raise NotFoundError("La mesa seleccionada no existe.")
        if not table.is_active:
            raise BusinessRuleError("La mesa seleccionada no está activa.")
        if payload.party_size > table.capacity:
            raise BusinessRuleError(
                f"La mesa '{table.code}' tiene capacidad máxima de {table.capacity} personas."
            )

        if self.reservation_repo.has_overlapping_reservation(
            table_id=table.id,
            start_time=payload.start_time,
            end_time=payload.end_time,
        ):
            raise ConflictError("La mesa seleccionada ya tiene una reserva activa en ese horario.")

        confirmation_code = f"RES-{secrets.token_hex(4).upper()}"
        reservation = Reservation(
            user_id=actor.id,
            table_id=table.id,
            customer_name=payload.customer_name.strip(),
            customer_email=payload.customer_email.lower().strip(),
            customer_phone=payload.customer_phone.strip(),
            party_size=payload.party_size,
            start_time=payload.start_time,
            end_time=payload.end_time,
            status="confirmed",
            confirmation_code=confirmation_code,
            notes=payload.notes,
        )

        try:
            created = self.reservation_repo.create(reservation)
            self.notification_service.add_notification(
                user_id=actor.id,
                event_type="reservation_confirmed",
                title=f"Reserva confirmada ({confirmation_code})",
                message=(
                    f"Tu reserva para {payload.party_size} personas en la mesa {table.name} "
                    f"({table.code}) ha sido confirmada."
                ),
                reference_type="reservation",
                reference_id=created.id,
            )
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise ConflictError(
                "No se pudo completar la reserva debido a un conflicto de disponibilidad."
            ) from exc

        return self.reservation_repo.get_by_id(created.id) or created

    def list_reservations(
        self,
        *,
        actor: User,
        status: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Reservation], int]:
        scoped_user_id = actor.id if actor.role.code == "customer" else None
        return self.reservation_repo.list_reservations(
            user_id=scoped_user_id,
            status=status,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
            offset=offset,
        )

    def get_reservation(self, reservation_id: UUID, actor: User) -> Reservation:
        reservation = self.reservation_repo.get_by_id(reservation_id)
        if reservation is None:
            raise NotFoundError("Reserva no encontrada.")
        if actor.role.code == "customer" and reservation.user_id != actor.id:
            raise ForbiddenError("No tiene permisos para consultar esta reserva.")
        return reservation

    def update_status(self, reservation_id: UUID, new_status: str, actor: User) -> Reservation:
        reservation = self.get_reservation(reservation_id, actor)
        if actor.role.code == "customer" and new_status != "cancelled":
            raise ForbiddenError("Un cliente solo puede cancelar su propia reserva.")

        allowed = RESERVATION_TRANSITIONS.get(reservation.status, set())
        if new_status not in allowed:
            raise BusinessRuleError(
                f"No es válido cambiar una reserva de '{reservation.status}' a '{new_status}'."
            )

        reservation.status = new_status
        self.notification_service.add_notification(
            user_id=reservation.user_id,
            event_type=f"reservation_{new_status}",
            title=f"Reserva {reservation.confirmation_code} actualizada",
            message=f"El estado de tu reserva cambió a '{new_status}'.",
            reference_type="reservation",
            reference_id=reservation.id,
        )
        self.reservation_repo.db.commit()
        return self.reservation_repo.get_by_id(reservation.id) or reservation
