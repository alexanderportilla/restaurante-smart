import os
from collections.abc import Generator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, IntegrityError

# Configurar variables de prueba antes de importar Settings/app (sin secretos reales)
os.environ.setdefault("APP_ENV", "test")
if os.getenv("RUN_POSTGRES_TESTS") != "1":
    os.environ.setdefault(
        "JWT_SECRET_KEY",
        "test-only-jwt-secret-key-with-minimum-32-chars-restaurante-smart",
    )
    os.environ.setdefault("APP_DB_PASSWORD", "test-only-db-password")

from app.api.dependencies import (
    get_auth_service,
    get_catalog_service,
    get_current_user,
    get_notification_service,
    get_optional_current_user,
    get_order_service,
    get_report_service,
    get_reservation_service,
    get_table_service,
    get_user_service,
)
from app.core.config import get_settings
from app.core.rate_limit import auth_rate_limiter
from app.core.security import create_access_token, hash_password
from app.db.session import get_db, get_engine
from app.main import create_app
from app.models.auth import Permission, Role, User
from app.models.orders import Notification, Order, OrderStatus
from app.models.restaurant import Category, Product, Reservation, RestaurantTable
from app.services.auth_service import AuthService
from app.services.catalog_service import CatalogService
from app.services.notification_service import NotificationService
from app.services.order_service import OrderService
from app.services.report_service import ReportService
from app.services.reservation_service import ReservationService
from app.services.table_service import TableService
from app.services.user_service import UserService


class InMemorySession:
    """Simula control transaccional commit/rollback/refresh en pruebas unitarias."""

    def __init__(self) -> None:
        self.committed = 0
        self.rolled_back = 0
        self.fail_next_commit_integrity = False

    def commit(self) -> None:
        if self.fail_next_commit_integrity:
            self.fail_next_commit_integrity = False
            raise IntegrityError("INSERT", {}, Exception("uq_reservations_no_overlap"))
        self.committed += 1

    def rollback(self) -> None:
        self.rolled_back += 1

    def refresh(self, _obj: Any) -> None:
        return None


class InMemoryStore:
    """Almacén en memoria compartido para repositorios falsos en pruebas."""

    def __init__(self) -> None:
        self.db = InMemorySession()
        now = datetime.now(UTC)

        perms = {
            code: Permission(id=idx, code=code, description=code, created_at=now)
            for idx, code in enumerate(
                [
                    "users:read",
                    "users:write",
                    "catalog:write",
                    "tables:write",
                    "reservations:manage",
                    "orders:manage",
                    "reports:read",
                ],
                start=1,
            )
        }
        self.roles: dict[str, Role] = {
            "admin": Role(
                id=1,
                code="admin",
                name="Administrador",
                description="Admin",
                permissions=list(perms.values()),
                created_at=now,
                updated_at=now,
            ),
            "manager": Role(
                id=2,
                code="manager",
                name="Gerente",
                description="Manager",
                permissions=[
                    perms["users:read"],
                    perms["catalog:write"],
                    perms["tables:write"],
                    perms["reservations:manage"],
                    perms["orders:manage"],
                    perms["reports:read"],
                ],
                created_at=now,
                updated_at=now,
            ),
            "staff": Role(
                id=3,
                code="staff",
                name="Personal",
                description="Staff",
                permissions=[perms["reservations:manage"], perms["orders:manage"]],
                created_at=now,
                updated_at=now,
            ),
            "customer": Role(
                id=4,
                code="customer",
                name="Cliente",
                description="Customer",
                permissions=[],
                created_at=now,
                updated_at=now,
            ),
        }
        self.users: dict[UUID, User] = {}
        self.categories: dict[int, Category] = {}
        self.products: dict[int, Product] = {}
        self.tables: dict[int, RestaurantTable] = {}
        self.reservations: dict[UUID, Reservation] = {}
        self.orders: dict[UUID, Order] = {}
        self.notifications: dict[UUID, Notification] = {}
        self.order_statuses: dict[str, OrderStatus] = {
            "pending": OrderStatus(
                id=1, code="pending", name="Pendiente", sort_order=1, is_terminal=False
            ),
            "confirmed": OrderStatus(
                id=2, code="confirmed", name="Confirmado", sort_order=2, is_terminal=False
            ),
            "preparing": OrderStatus(
                id=3, code="preparing", name="En preparación", sort_order=3, is_terminal=False
            ),
            "ready": OrderStatus(
                id=4, code="ready", name="Listo para entregar", sort_order=4, is_terminal=False
            ),
            "delivered": OrderStatus(
                id=5, code="delivered", name="Entregado", sort_order=5, is_terminal=True
            ),
            "cancelled": OrderStatus(
                id=6, code="cancelled", name="Cancelado", sort_order=6, is_terminal=True
            ),
        }
        self._seq = 100

    def next_id(self) -> int:
        self._seq += 1
        return self._seq

    def seed_user(
        self,
        *,
        role_code: str,
        email: str,
        full_name: str,
        raw_secret: str | None = None,
    ) -> User:
        role = self.roles[role_code]
        now = datetime.now(UTC)
        user = User(
            id=uuid4(),
            role_id=role.id,
            full_name=full_name,
            email=email.lower(),
            phone="0999999999",
            password_hash=hash_password(raw_secret if raw_secret is not None else "TestPass123!"),
            is_active=True,
            role=role,
            created_at=now,
            updated_at=now,
        )
        self.users[user.id] = user
        return user


class FakeUserRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db

    def get_by_id(self, user_id: UUID) -> User | None:
        return self.store.users.get(user_id)

    def get_by_email(self, email: str) -> User | None:
        norm = email.lower().strip()
        return next((u for u in self.store.users.values() if u.email == norm), None)

    def list_users(self, *, limit: int = 20, offset: int = 0) -> tuple[list[User], int]:
        items = list(self.store.users.values())
        return items[offset : offset + limit], len(items)

    def get_role_by_code(self, code: str) -> Role | None:
        return self.store.roles.get(code)

    def list_roles(self) -> list[Role]:
        return list(self.store.roles.values())

    def create(self, user: User) -> User:
        now = datetime.now(UTC)
        if user.id is None:
            user.id = uuid4()
        user.created_at = now
        user.updated_at = now
        user.role = next(r for r in self.store.roles.values() if r.id == user.role_id)
        self.store.users[user.id] = user
        return user


class FakeCatalogRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db

    def list_categories(self, *, only_active: bool = False) -> list[Category]:
        cats = list(self.store.categories.values())
        return [c for c in cats if c.is_active] if only_active else cats

    def get_category_by_id(self, category_id: int) -> Category | None:
        return self.store.categories.get(category_id)

    def get_category_by_slug_or_name(
        self, slug: str, name: str, *, exclude_category_id: int | None = None
    ) -> Category | None:
        return next(
            (
                c
                for c in self.store.categories.values()
                if (c.slug == slug or c.name == name)
                and (exclude_category_id is None or c.id != exclude_category_id)
            ),
            None,
        )

    def create_category(self, category: Category) -> Category:
        now = datetime.now(UTC)
        category.id = self.store.next_id()
        category.created_at = now
        category.updated_at = now
        self.store.categories[category.id] = category
        return category

    def list_products(
        self,
        *,
        category_id: int | None = None,
        only_available: bool | None = None,
        only_active: bool = True,
        search: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Product], int]:
        items = list(self.store.products.values())
        if only_active:
            items = [p for p in items if p.is_active]
        if category_id is not None:
            items = [p for p in items if p.category_id == category_id]
        if only_available is not None:
            items = [p for p in items if p.is_available == only_available]
        if search:
            q = search.lower().strip()
            items = [
                p
                for p in items
                if q in p.name.lower() or (p.description and q in p.description.lower())
            ]
        return items[offset : offset + limit], len(items)

    def get_product_by_id(self, product_id: int) -> Product | None:
        return self.store.products.get(product_id)

    def get_product_by_sku(self, sku: str) -> Product | None:
        return next((p for p in self.store.products.values() if p.sku == sku), None)

    def get_products_by_ids(self, product_ids: list[int]) -> list[Product]:
        return [self.store.products[pid] for pid in product_ids if pid in self.store.products]

    def create_product(self, product: Product) -> Product:
        now = datetime.now(UTC)
        product.id = self.store.next_id()
        product.category = self.store.categories[product.category_id]
        product.created_at = now
        product.updated_at = now
        self.store.products[product.id] = product
        return product


class FakeTableRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db
        self.locked_ids: list[int] = []

    def list_tables(self, *, only_active: bool = False) -> list[RestaurantTable]:
        items = list(self.store.tables.values())
        return [t for t in items if t.is_active] if only_active else items

    def get_by_id(self, table_id: int) -> RestaurantTable | None:
        return self.store.tables.get(table_id)

    def lock_by_id(self, table_id: int) -> RestaurantTable | None:
        self.locked_ids.append(table_id)
        return self.store.tables.get(table_id)

    def get_by_code(self, code: str) -> RestaurantTable | None:
        return next((t for t in self.store.tables.values() if t.code == code), None)

    def create(self, table: RestaurantTable) -> RestaurantTable:
        now = datetime.now(UTC)
        table.id = self.store.next_id()
        table.created_at = now
        table.updated_at = now
        self.store.tables[table.id] = table
        return table

    def find_available_tables(
        self,
        *,
        start_time: datetime,
        end_time: datetime,
        party_size: int,
    ) -> list[RestaurantTable]:
        busy_ids = {
            r.table_id
            for r in self.store.reservations.values()
            if r.status in {"pending", "confirmed"}
            and r.start_time < end_time
            and r.end_time > start_time
        }
        return [
            t
            for t in self.store.tables.values()
            if t.is_active and t.capacity >= party_size and t.id not in busy_ids
        ]


class FakeReservationRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db

    def get_by_id(self, reservation_id: UUID) -> Reservation | None:
        return self.store.reservations.get(reservation_id)

    def has_overlapping_reservation(
        self,
        *,
        table_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_reservation_id: UUID | None = None,
    ) -> bool:
        return any(
            r.table_id == table_id
            and r.id != exclude_reservation_id
            and r.status in {"pending", "confirmed"}
            and r.start_time < end_time
            and r.end_time > start_time
            for r in self.store.reservations.values()
        )

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
        items = list(self.store.reservations.values())
        if user_id is not None:
            items = [r for r in items if r.user_id == user_id]
        if status is not None:
            items = [r for r in items if r.status == status]
        if from_date is not None:
            items = [r for r in items if r.end_time >= from_date]
        if to_date is not None:
            items = [r for r in items if r.start_time <= to_date]
        return items[offset : offset + limit], len(items)

    def create(self, reservation: Reservation) -> Reservation:
        now = datetime.now(UTC)
        reservation.id = uuid4()
        reservation.table = self.store.tables[reservation.table_id]
        reservation.created_at = now
        reservation.updated_at = now
        self.store.reservations[reservation.id] = reservation
        return reservation


class FakeOrderRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db

    def list_statuses(self) -> list[OrderStatus]:
        return list(self.store.order_statuses.values())

    def get_status_by_code(self, code: str) -> OrderStatus | None:
        return self.store.order_statuses.get(code)

    def get_by_id(self, order_id: UUID) -> Order | None:
        return self.store.orders.get(order_id)

    def list_orders(
        self,
        *,
        user_id: UUID | None = None,
        status_code: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Order], int]:
        items = list(self.store.orders.values())
        if user_id is not None:
            items = [o for o in items if o.user_id == user_id]
        if status_code is not None:
            items = [o for o in items if o.status.code == status_code]
        return items[offset : offset + limit], len(items)

    def create(self, order: Order) -> Order:
        now = datetime.now(UTC)
        order.id = uuid4()
        order.status = next(
            s for s in self.store.order_statuses.values() if s.id == order.status_id
        )
        order.created_at = now
        order.updated_at = now
        for idx, item in enumerate(order.items, start=1):
            item.id = idx
            item.order_id = order.id
            item.product = self.store.products[item.product_id]
        self.store.orders[order.id] = order
        return order

    def get_summary_metrics(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> dict[str, Any]:
        orders = list(self.store.orders.values())
        if from_date is not None:
            orders = [o for o in orders if o.created_at >= from_date]
        if to_date is not None:
            orders = [o for o in orders if o.created_at <= to_date]

        revenue = sum(
            (o.total_amount for o in orders if o.status.code != "cancelled"),
            Decimal("0.00"),
        )
        reservations = list(self.store.reservations.values())
        active_tables = sum(1 for t in self.store.tables.values() if t.is_active)
        by_status = [
            {
                "status_code": s.code,
                "status_name": s.name,
                "count": sum(1 for o in orders if o.status.code == s.code),
            }
            for s in self.store.order_statuses.values()
        ]
        return {
            "total_orders": len(orders),
            "total_revenue": revenue,
            "total_reservations": len(reservations),
            "active_tables": active_tables,
            "orders_by_status": by_status,
        }

    def get_top_products(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        totals: dict[int, dict[str, Any]] = {}
        for order in self.store.orders.values():
            if order.status.code == "cancelled":
                continue
            if from_date is not None and order.created_at < from_date:
                continue
            if to_date is not None and order.created_at > to_date:
                continue
            for item in order.items:
                entry = totals.setdefault(
                    item.product_id,
                    {
                        "product_id": item.product_id,
                        "product_name": item.product.name,
                        "sku": item.product.sku,
                        "total_quantity": 0,
                        "total_revenue": Decimal("0.00"),
                    },
                )
                entry["total_quantity"] += item.quantity
                entry["total_revenue"] += item.line_total
        return sorted(totals.values(), key=lambda x: x["total_quantity"], reverse=True)[:limit]


class FakeNotificationRepo:
    def __init__(self, store: InMemoryStore) -> None:
        self.store = store
        self.db = store.db

    def get_by_id(self, notification_id: UUID) -> Notification | None:
        return self.store.notifications.get(notification_id)

    def list_for_user(
        self,
        *,
        user_id: UUID,
        unread_only: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Notification], int]:
        items = [n for n in self.store.notifications.values() if n.user_id == user_id]
        if unread_only:
            items = [n for n in items if not n.is_read]
        return items[offset : offset + limit], len(items)

    def create(self, notification: Notification) -> Notification:
        now = datetime.now(UTC)
        notification.id = uuid4()
        notification.sent_at = now
        notification.created_at = now
        self.store.notifications[notification.id] = notification
        return notification


@pytest.fixture(autouse=True)
def _reset_auth_rate_limiter() -> Generator[None]:
    auth_rate_limiter.clear()
    yield
    auth_rate_limiter.clear()


@pytest.fixture
def store() -> InMemoryStore:
    get_settings.cache_clear()
    return InMemoryStore()


@pytest.fixture
def api_context(store: InMemoryStore) -> Generator[dict[str, Any]]:
    """Prepara FastAPI TestClient con usuarios de los 4 roles y repositorios en memoria."""
    app = create_app()

    admin = store.seed_user(role_code="admin", email="admin@example.com", full_name="Admin Smart")
    manager = store.seed_user(
        role_code="manager", email="manager@example.com", full_name="Manager Smart"
    )
    staff = store.seed_user(role_code="staff", email="staff@example.com", full_name="Staff Smart")
    customer = store.seed_user(
        role_code="customer", email="cliente@example.com", full_name="Cliente Smart"
    )

    class HealthyDB:
        def execute(self, _stmt: Any) -> int:
            return 1

        def close(self) -> None:
            return None

    notif_service = NotificationService(FakeNotificationRepo(store))  # type: ignore[arg-type]

    app.dependency_overrides[get_db] = lambda: HealthyDB()
    app.dependency_overrides[get_auth_service] = lambda: AuthService(FakeUserRepo(store))  # type: ignore[arg-type]
    app.dependency_overrides[get_user_service] = lambda: UserService(FakeUserRepo(store))  # type: ignore[arg-type]
    app.dependency_overrides[get_catalog_service] = lambda: CatalogService(FakeCatalogRepo(store))  # type: ignore[arg-type]
    app.dependency_overrides[get_table_service] = lambda: TableService(FakeTableRepo(store))  # type: ignore[arg-type]
    app.dependency_overrides[get_notification_service] = lambda: notif_service
    app.dependency_overrides[get_reservation_service] = lambda: ReservationService(
        reservation_repo=FakeReservationRepo(store),  # type: ignore[arg-type]
        table_repo=FakeTableRepo(store),  # type: ignore[arg-type]
        notification_service=notif_service,
    )
    app.dependency_overrides[get_order_service] = lambda: OrderService(
        order_repo=FakeOrderRepo(store),  # type: ignore[arg-type]
        catalog_repo=FakeCatalogRepo(store),  # type: ignore[arg-type]
        table_repo=FakeTableRepo(store),  # type: ignore[arg-type]
        reservation_repo=FakeReservationRepo(store),  # type: ignore[arg-type]
        notification_service=notif_service,
    )
    app.dependency_overrides[get_report_service] = lambda: ReportService(FakeOrderRepo(store))  # type: ignore[arg-type]

    from fastapi import Depends

    from app.api.dependencies import bearer_scheme
    from app.core.exceptions import ForbiddenError, UnauthorizedError
    from app.core.security import decode_access_token

    def override_current_user(credentials: Any = Depends(bearer_scheme)) -> User:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise UnauthorizedError("Se requiere token de autenticación Bearer.")
        payload = decode_access_token(credentials.credentials)
        user = store.users.get(UUID(str(payload["sub"])))
        if user is None:
            raise UnauthorizedError("El usuario asociado al token no existe.")
        if not user.is_active:
            raise ForbiddenError("La cuenta de usuario está desactivada.")
        return user

    def override_optional_current_user(credentials: Any = Depends(bearer_scheme)) -> User | None:
        if credentials is None:
            return None
        return override_current_user(credentials)

    app.dependency_overrides[get_current_user] = override_current_user
    app.dependency_overrides[get_optional_current_user] = override_optional_current_user

    def auth_headers(user: User) -> dict[str, str]:
        token = create_access_token(user.id, user.role.code)
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield {
            "app": app,
            "client": client,
            "store": store,
            "users": {
                "admin": admin,
                "manager": manager,
                "staff": staff,
                "customer": customer,
            },
            "headers": {
                "admin": auth_headers(admin),
                "manager": auth_headers(manager),
                "staff": auth_headers(staff),
                "customer": auth_headers(customer),
            },
        }


ALLOWED_TEST_DB_DRIVERS = frozenset({"postgresql", "postgresql+psycopg"})
ALLOWED_TEST_DB_HOSTS = frozenset({"127.0.0.1", "localhost"})
ALLOWED_TEST_DB_PORT = 5433
ALLOWED_TEST_DB_NAME = "restaurante_smart_test"
ALLOWED_TEST_DB_USER = "restaurante_test_user"
FORBIDDEN_TEST_DB_QUERY_PARAMS = frozenset(
    {
        "host",
        "hostaddr",
        "port",
        "service",
        "passfile",
        "pgpassfile",
        "options",
        "target_session_attrs",
        "sslmode",
        "sslkey",
        "sslcert",
        "sslrootcert",
        "gsslib",
    }
)


def validate_isolated_test_database_url(raw_url: str) -> str:
    """Valida por allowlist estricta que TEST_DATABASE_URL apunte solo a la BD local aislada."""
    if not isinstance(raw_url, str):
        raise ValueError("TEST_DATABASE_URL debe ser una cadena de texto.")

    candidate = raw_url.strip()
    if not candidate:
        raise ValueError("TEST_DATABASE_URL es obligatoria cuando RUN_POSTGRES_TESTS=1.")

    if any(ch.isspace() or ord(ch) < 32 for ch in candidate):
        raise ValueError(
            "TEST_DATABASE_URL contiene caracteres de espacio o control no permitidos."
        )

    try:
        split_url = urlsplit(candidate)
        parsed = make_url(candidate)
    except (ArgumentError, ValueError):
        raise ValueError("TEST_DATABASE_URL tiene un formato de URL inválido.") from None

    if split_url.fragment:
        raise ValueError("TEST_DATABASE_URL no debe incluir fragmentos de URL.")

    if parsed.drivername not in ALLOWED_TEST_DB_DRIVERS:
        raise ValueError(
            "Esquema/driver de TEST_DATABASE_URL no permitido; "
            "solo se admite 'postgresql' o 'postgresql+psycopg'."
        )

    if parsed.host not in ALLOWED_TEST_DB_HOSTS:
        raise ValueError(
            "Host de TEST_DATABASE_URL no permitido; solo se admite '127.0.0.1' o 'localhost'."
        )

    if parsed.port != ALLOWED_TEST_DB_PORT:
        raise ValueError("Puerto de TEST_DATABASE_URL no permitido; debe ser exactamente 5433.")

    if parsed.database != ALLOWED_TEST_DB_NAME:
        raise ValueError(
            "Base de datos de TEST_DATABASE_URL no permitida; "
            "debe ser exactamente 'restaurante_smart_test'."
        )

    if parsed.username != ALLOWED_TEST_DB_USER:
        raise ValueError(
            "Usuario de TEST_DATABASE_URL no permitido; "
            "debe ser exactamente 'restaurante_test_user'."
        )

    if not parsed.password:
        raise ValueError("TEST_DATABASE_URL debe incluir una contraseña no vacía.")

    query_keys = {key.strip().lower() for key in parsed.query}
    forbidden_keys = sorted(query_keys & FORBIDDEN_TEST_DB_QUERY_PARAMS)
    if forbidden_keys:
        raise ValueError(
            "Parámetros de conexión prohibidos en TEST_DATABASE_URL: "
            + ", ".join(forbidden_keys)
            + "."
        )

    if parsed.query or split_url.query or "?" in candidate:
        raise ValueError("No se permiten parámetros de consulta en TEST_DATABASE_URL.")

    return candidate


def require_isolated_test_database_url(run_flag: str | None, raw_url: str | None) -> str:
    """Valida RUN_POSTGRES_TESTS == '1' y la allowlist estricta de TEST_DATABASE_URL."""
    if run_flag != "1":
        raise ValueError("RUN_POSTGRES_TESTS debe ser exactamente '1'.")
    if raw_url is None:
        raise ValueError("TEST_DATABASE_URL es obligatoria cuando RUN_POSTGRES_TESTS=1.")
    return validate_isolated_test_database_url(raw_url)


def apply_isolated_postgres_test_env(monkeypatch: pytest.MonkeyPatch) -> str | None:
    """Aplica TEST_DATABASE_URL validada a DATABASE_URL sin crear conexiones si falla."""
    if os.getenv("RUN_POSTGRES_TESTS") != "1":
        return None
    try:
        validated_url = require_isolated_test_database_url(
            os.getenv("RUN_POSTGRES_TESTS"),
            os.getenv("TEST_DATABASE_URL"),
        )
    except ValueError as exc:
        pytest.fail(str(exc), pytrace=False)
    monkeypatch.setenv("DATABASE_URL", validated_url)
    get_settings.cache_clear()
    get_engine.cache_clear()
    return validated_url


def assert_isolated_postgres_test_env() -> str:
    """Revalida la allowlist estricta antes de abrir sesiones o motores SQLAlchemy."""
    try:
        validated_url = require_isolated_test_database_url(
            os.getenv("RUN_POSTGRES_TESTS"),
            os.getenv("TEST_DATABASE_URL"),
        )
    except ValueError as exc:
        pytest.fail(str(exc), pytrace=False)
    if os.getenv("DATABASE_URL") != validated_url:
        pytest.fail(
            "DATABASE_URL no coincide con TEST_DATABASE_URL aislada validada.",
            pytrace=False,
        )
    return validated_url
