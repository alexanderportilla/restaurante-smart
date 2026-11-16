from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_table_service, require_roles
from app.models.auth import User
from app.schemas.tables import TableCreate, TableResponse, TableUpdate
from app.services.table_service import TableService

router = APIRouter(prefix="/tables", tags=["Mesas"])


@router.get("", response_model=list[TableResponse])
def list_tables(
    only_active: bool = Query(default=False),
    table_service: TableService = Depends(get_table_service),
) -> list[TableResponse]:
    return table_service.list_tables(only_active=only_active)


@router.post("", response_model=TableResponse, status_code=status.HTTP_201_CREATED)
def create_table(
    payload: TableCreate,
    _actor: User = Depends(require_roles("admin", "manager")),
    table_service: TableService = Depends(get_table_service),
) -> TableResponse:
    return table_service.create_table(payload)


@router.patch("/{table_id}", response_model=TableResponse)
def update_table(
    table_id: int,
    payload: TableUpdate,
    _actor: User = Depends(require_roles("admin", "manager")),
    table_service: TableService = Depends(get_table_service),
) -> TableResponse:
    return table_service.update_table(table_id, payload)
