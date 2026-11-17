from collections.abc import Callable
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.auth import User
from app.repositories.catalog_repository import CatalogRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.reservation_repository import ReservationRepository
from app.repositories.table_repository import TableRepository
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.catalog_service import CatalogService
from app.services.notification_service import NotificationService
from app.services.order_service import OrderService
from app.services.report_service import ReportService
from app.services.reservation_service import ReservationService
from app.services.table_service import TableService
from app.services.user_service import UserService

bearer_scheme = HTTPBearer(auto_error=False)


def _resolve_user_from_credentials(
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError("Se requiere token de autenticación Bearer.")

    payload = decode_access_token(credentials.credentials)
    try:
        user_id = UUID(str(payload["sub"]))
    except ValueError as exc:
        raise UnauthorizedError("Identificador de usuario inválido en el token.") from exc

    user = UserRepository(db).get_by_id(user_id)
    if user is None:
        raise UnauthorizedError("El usuario asociado al token no existe.")
    if not user.is_active:
        raise ForbiddenError("La cuenta de usuario está desactivada.")
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Extrae y valida el token Bearer JWT y retorna el usuario activo."""
    return _resolve_user_from_credentials(credentials, db)


def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Retorna el usuario activo si se envía Authorization Bearer válido, o None si es anónimo."""
    if credentials is None:
        return None
    return _resolve_user_from_credentials(credentials, db)


def require_roles(*allowed_roles: str) -> Callable[[User], User]:
    """Dependencia de autorización RBAC basada en códigos de rol."""

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role.code not in allowed_roles:
            raise ForbiddenError("No posee el rol requerido para ejecutar esta operación.")
        return current_user

    return dependency


def require_permissions(*required_permissions: str) -> Callable[[User], User]:
    """Dependencia de autorización RBAC basada en permisos efectivos del rol."""

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        effective = {perm.code for perm in current_user.role.permissions}
        if not set(required_permissions).issubset(effective):
            raise ForbiddenError("No posee los permisos requeridos para ejecutar esta operación.")
        return current_user

    return dependency


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(UserRepository(db))


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(UserRepository(db))


def get_catalog_service(db: Session = Depends(get_db)) -> CatalogService:
    return CatalogService(CatalogRepository(db))


def get_table_service(db: Session = Depends(get_db)) -> TableService:
    return TableService(TableRepository(db))


def get_notification_service(db: Session = Depends(get_db)) -> NotificationService:
    return NotificationService(NotificationRepository(db))


def get_reservation_service(db: Session = Depends(get_db)) -> ReservationService:
    return ReservationService(
        reservation_repo=ReservationRepository(db),
        table_repo=TableRepository(db),
        notification_service=NotificationService(NotificationRepository(db)),
    )


def get_order_service(db: Session = Depends(get_db)) -> OrderService:
    return OrderService(
        order_repo=OrderRepository(db),
        catalog_repo=CatalogRepository(db),
        table_repo=TableRepository(db),
        reservation_repo=ReservationRepository(db),
        notification_service=NotificationService(NotificationRepository(db)),
    )


def get_report_service(db: Session = Depends(get_db)) -> ReportService:
    return ReportService(OrderRepository(db))
