from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.core.exceptions import BusinessRuleError, ConflictError, ForbiddenError, UnauthorizedError
from app.models.restaurant import Category, Product, RestaurantTable
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.orders import OrderCreate, OrderItemCreate
from app.schemas.reservations import ReservationCreate
from app.schemas.users import UserUpdate
from app.services.auth_service import AuthService
from app.services.notification_service import NotificationService
from app.services.order_service import OrderService
from app.services.reservation_service import ReservationService
from app.services.table_service import TableService
from app.services.user_service import UserService
from tests.conftest import (
    FakeCatalogRepo,
    FakeNotificationRepo,
    FakeOrderRepo,
    FakeReservationRepo,
    FakeTableRepo,
    FakeUserRepo,
    InMemoryStore,
)


def test_auth_register_login_and_inactive_user(store: InMemoryStore) -> None:
    service = AuthService(FakeUserRepo(store))  # type: ignore[arg-type]
    user = service.register(
        RegisterRequest(
            full_name="Ana Pérez",
            email="ANA@EXAMPLE.COM",
            phone="0991234567",
            password="Password123!",
        )
    )
    assert user.email == "ana@example.com"
    assert user.role.code == "customer"

    with pytest.raises(ConflictError):
        service.register(
            RegisterRequest(full_name="Ana 2", email="ana@example.com", password="Password123!")
        )

    token = service.login(LoginRequest(email="ana@example.com", password="Password123!"))
    assert token.access_token
    assert token.user.role_code == "customer"

    with pytest.raises(UnauthorizedError):
        service.login(LoginRequest(email="ana@example.com", password="WrongPassword"))

    user.is_active = False
    with pytest.raises(ForbiddenError):
        service.login(LoginRequest(email="ana@example.com", password="Password123!"))


def test_reservation_locking_overlap_and_cancellation(store: InMemoryStore) -> None:
    now = datetime.now(UTC)
    customer = store.seed_user(role_code="customer", email="c1@example.com", full_name="Cliente 1")
    other = store.seed_user(role_code="customer", email="c2@example.com", full_name="Cliente 2")
    table = FakeTableRepo(store).create(
        RestaurantTable(code="M-01", name="Mesa 1", capacity=4, location="Terraza", is_active=True)
    )

    table_repo = FakeTableRepo(store)
    res_repo = FakeReservationRepo(store)
    notif_service = NotificationService(FakeNotificationRepo(store))  # type: ignore[arg-type]
    service = ReservationService(res_repo, table_repo, notif_service)  # type: ignore[arg-type]
    t_service = TableService(table_repo)  # type: ignore[arg-type]

    start = now + timedelta(hours=2)
    end = now + timedelta(hours=4)

    # Excede capacidad
    with pytest.raises(BusinessRuleError):
        service.create_reservation(
            ReservationCreate(
                table_id=table.id,
                customer_name="Cliente 1",
                customer_email="c1@example.com",
                customer_phone="099111222",
                party_size=6,
                start_time=start,
                end_time=end,
            ),
            customer,
        )

    created = service.create_reservation(
        ReservationCreate(
            table_id=table.id,
            customer_name="Cliente 1",
            customer_email="c1@example.com",
            customer_phone="099111222",
            party_size=4,
            start_time=start,
            end_time=end,
        ),
        customer,
    )
    assert created.status == "confirmed"
    assert table.id in table_repo.locked_ids
    assert len(store.notifications) == 1

    # Disponibilidad debe excluir la mesa en esa franja
    assert t_service.check_availability(start_time=start, end_time=end, party_size=2) == []

    # Reserva solapada debe fallar con ConflictError
    with pytest.raises(ConflictError):
        service.create_reservation(
            ReservationCreate(
                table_id=table.id,
                customer_name="Cliente 2",
                customer_email="c2@example.com",
                customer_phone="099333444",
                party_size=2,
                start_time=start + timedelta(minutes=30),
                end_time=end + timedelta(minutes=30),
            ),
            other,
        )

    # Otro cliente no puede cancelar ni consultar
    with pytest.raises(ForbiddenError):
        service.update_status(created.id, "cancelled", other)

    # Cliente no puede marcar 'completed'
    with pytest.raises(ForbiddenError):
        service.update_status(created.id, "completed", customer)

    # Cancelar libera la mesa inmediatamente
    cancelled = service.update_status(created.id, "cancelled", customer)
    assert cancelled.status == "cancelled"
    assert t_service.check_availability(start_time=start, end_time=end, party_size=2) == [table]

    # Simula IntegrityError de PostgreSQL EXCLUDE USING gist
    store.db.fail_next_commit_integrity = True
    with pytest.raises(ConflictError):
        service.create_reservation(
            ReservationCreate(
                table_id=table.id,
                customer_name="Cliente 2",
                customer_email="c2@example.com",
                customer_phone="099333444",
                party_size=2,
                start_time=start,
                end_time=end,
            ),
            other,
        )
    assert store.db.rolled_back == 1


def test_order_server_calculations_and_status_transitions(store: InMemoryStore) -> None:
    customer = store.seed_user(role_code="customer", email="cli@example.com", full_name="Cliente")
    staff = store.seed_user(role_code="staff", email="staff@example.com", full_name="Staff")
    cat = FakeCatalogRepo(store).create_category(
        Category(name="Platos Fuertes", slug="platos-fuertes", display_order=1, is_active=True)
    )
    prod = FakeCatalogRepo(store).create_product(
        Product(
            category_id=cat.id,
            name="Lomo Saltado",
            sku="PL-001",
            price=Decimal("12.50"),
            preparation_minutes=20,
            is_available=True,
            is_active=True,
        )
    )

    notif_service = NotificationService(FakeNotificationRepo(store))  # type: ignore[arg-type]
    service = OrderService(
        order_repo=FakeOrderRepo(store),  # type: ignore[arg-type]
        catalog_repo=FakeCatalogRepo(store),  # type: ignore[arg-type]
        table_repo=FakeTableRepo(store),  # type: ignore[arg-type]
        reservation_repo=FakeReservationRepo(store),  # type: ignore[arg-type]
        notification_service=notif_service,
    )

    # dine_in sin mesa ni reserva debe rechazarse
    with pytest.raises(BusinessRuleError):
        service.create_order(
            OrderCreate(
                order_type="dine_in",
                items=[OrderItemCreate(product_id=prod.id, quantity=1)],
            ),
            customer,
        )

    order = service.create_order(
        OrderCreate(order_type="takeaway", items=[OrderItemCreate(product_id=prod.id, quantity=2)]),
        customer,
    )
    assert order.subtotal == Decimal("25.00")
    assert order.tax_amount == Decimal("3.00")
    assert order.total_amount == Decimal("28.00")
    assert order.status.code == "pending"
    assert len(store.notifications) == 1

    # Cliente no puede confirmar pedido
    with pytest.raises(ForbiddenError):
        service.update_status(order.id, "confirmed", customer)

    # Transición válida por staff
    confirmed = service.update_status(order.id, "confirmed", staff)
    assert confirmed.status.code == "confirmed"
    assert confirmed.confirmed_at is not None

    # Salto inválido confirmed -> delivered
    with pytest.raises(BusinessRuleError):
        service.update_status(order.id, "delivered", staff)


def test_user_service_rbac_rules(store: InMemoryStore) -> None:
    admin = store.seed_user(role_code="admin", email="a@example.com", full_name="Admin")
    customer = store.seed_user(role_code="customer", email="c@example.com", full_name="Cliente")
    service = UserService(FakeUserRepo(store))  # type: ignore[arg-type]

    with pytest.raises(ForbiddenError):
        service.update_user(customer.id, UserUpdate(role_code="admin"), customer)

    updated = service.update_user(customer.id, UserUpdate(role_code="staff"), admin)
    assert updated.role.code == "staff"
