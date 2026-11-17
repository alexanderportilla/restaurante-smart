from datetime import datetime

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.restaurant import RestaurantTable
from app.repositories.base import apply_updates, commit_or_conflict
from app.repositories.table_repository import TableRepository
from app.schemas.tables import TableCreate, TableUpdate


class TableService:
    """Servicio de administración de mesas y cálculo de disponibilidad."""

    def __init__(self, table_repo: TableRepository) -> None:
        self.table_repo = table_repo

    def list_tables(self, *, only_active: bool = False) -> list[RestaurantTable]:
        return self.table_repo.list_tables(only_active=only_active)

    def get_table(self, table_id: int) -> RestaurantTable:
        table = self.table_repo.get_by_id(table_id)
        if table is None:
            raise NotFoundError("Mesa no encontrada.")
        return table

    def create_table(self, payload: TableCreate) -> RestaurantTable:
        normalized_code = payload.code.strip()
        if self.table_repo.get_by_code(normalized_code) is not None:
            raise ConflictError("Ya existe una mesa registrada con ese código.")
        data = payload.model_dump()
        data["code"] = normalized_code
        data["name"] = payload.name.strip()
        data["location"] = payload.location.strip()
        table = RestaurantTable(**data)
        created = self.table_repo.create(table)
        commit_or_conflict(
            self.table_repo.db,
            "Ya existe una mesa registrada con ese código.",
        )
        return created

    def update_table(self, table_id: int, payload: TableUpdate) -> RestaurantTable:
        table = self.table_repo.get_by_id(table_id)
        if table is None:
            raise NotFoundError("Mesa no encontrada.")
        updates = payload.model_dump(exclude_unset=True)
        if "code" in updates:
            updates["code"] = updates["code"].strip()
            if (
                updates["code"] != table.code
                and self.table_repo.get_by_code(updates["code"]) is not None
            ):
                raise ConflictError("Ya existe una mesa con ese código.")
        if "name" in updates:
            updates["name"] = updates["name"].strip()
        if "location" in updates:
            updates["location"] = updates["location"].strip()
        apply_updates(table, updates)
        commit_or_conflict(self.table_repo.db, "Ya existe una mesa con ese código.")
        self.table_repo.db.refresh(table)
        return table

    def check_availability(
        self,
        *,
        start_time: datetime,
        end_time: datetime,
        party_size: int,
    ) -> list[RestaurantTable]:
        if start_time.tzinfo is None or end_time.tzinfo is None:
            raise BusinessRuleError("Las fechas deben incluir zona horaria (UTC/ISO 8601).")
        if end_time <= start_time:
            raise BusinessRuleError("La hora de fin debe ser posterior a la hora de inicio.")
        if party_size <= 0:
            raise BusinessRuleError("El número de comensales debe ser mayor a cero.")

        return self.table_repo.find_available_tables(
            start_time=start_time,
            end_time=end_time,
            party_size=party_size,
        )
