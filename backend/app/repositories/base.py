from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError


def paginate_scalars[ModelT](
    db: Session,
    stmt: Select[tuple[ModelT]],
    *,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[ModelT], int]:
    """Ejecuta una consulta paginada y retorna (items, total)."""
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total: int = db.execute(count_stmt).scalar_one()
    items = list(db.scalars(stmt.limit(limit).offset(offset)).all())
    return items, total


def apply_updates(instance: Any, updates: dict[str, Any]) -> Any:
    """Aplica cambios parciales no nulos sobre una instancia ORM."""
    for field, value in updates.items():
        setattr(instance, field, value)
    return instance


def commit_or_conflict(db: Session, conflict_message: str) -> None:
    """Confirma la transacción traduciendo IntegrityError a ConflictError sin exponer SQL."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(conflict_message) from exc
