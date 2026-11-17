from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError, UnauthorizedError
from app.core.rate_limit import extract_client_ip
from app.core.security import create_access_token, decode_access_token
from app.models.restaurant import Category, Product, RestaurantTable
from app.schemas.auth import RegisterRequest
from app.schemas.catalog import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate
from app.schemas.orders import OrderCreate, OrderItemCreate
from app.schemas.reservations import ReservationCreate
from app.schemas.tables import TableCreate, TableUpdate
from app.schemas.users import UserCreate, UserUpdate
from app.services.auth_service import AuthService
from app.services.catalog_service import CatalogService
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


def test_auth_rate_limiting_login_register_and_proxy_ip_trust(
    api_context: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: TestClient = api_context["client"]
    monkeypatch.setenv("AUTH_LOGIN_RATE_LIMIT", "3")
    monkeypatch.setenv("AUTH_LOGIN_RATE_WINDOW_SECONDS", "60")
    monkeypatch.setenv("AUTH_REGISTER_RATE_LIMIT", "2")
    monkeypatch.setenv("AUTH_REGISTER_RATE_WINDOW_SECONDS", "300")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", "127.0.0.1")
    get_settings.cache_clear()

    try:
        # 1. Login: 3 intentos permitidos, el 4to responde 429 con Retry-After uniforme
        for _ in range(3):
            res = client.post(
                "/api/v1/auth/login",
                json={"email": "cliente@example.com", "password": "WrongPassword123!"},
                headers={"X-Forwarded-For": "203.0.113.9"},
            )
            assert res.status_code == 401

        blocked = client.post(
            "/api/v1/auth/login",
            json={"email": "cliente@example.com", "password": "WrongPassword123!"},
            headers={"X-Forwarded-For": "203.0.113.99"},
        )
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
        assert int(blocked.headers["Retry-After"]) >= 1

        # 2. Register: 2 intentos permitidos, el 3ro responde 429
        for idx in range(2):
            reg = client.post(
                "/api/v1/auth/register",
                json={
                    "full_name": f"Rate User {idx}",
                    "email": f"rate{idx}@example.com",
                    "password": "Password123!",
                },
            )
            assert reg.status_code == 201

        reg_blocked = client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Rate User 3",
                "email": "rate3@example.com",
                "password": "Password123!",
            },
        )
        assert reg_blocked.status_code == 429
        assert reg_blocked.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()

    # 3. Spoofing de X-Forwarded-For desde host no confiable se ignora; desde proxy confiable se usa
    untrusted_req = Request(
        {
            "type": "http",
            "client": ("198.51.100.5", 50000),
            "headers": [(b"x-forwarded-for", b"203.0.113.77")],
        }
    )
    assert (
        extract_client_ip(untrusted_req, Settings(TRUSTED_PROXY_IPS="127.0.0.1")) == "198.51.100.5"
    )

    trusted_req = Request(
        {
            "type": "http",
            "client": ("127.0.0.1", 50000),
            "headers": [(b"x-forwarded-for", b"198.51.100.10, 203.0.113.50, 127.0.0.1")],
        }
    )
    assert (
        extract_client_ip(trusted_req, Settings(TRUSTED_PROXY_IPS="127.0.0.1,203.0.113.50"))
        == "198.51.100.10"
    )


def test_tables_and_products_authorization_and_inactive_filtering(
    api_context: dict[str, Any],
) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]

    # Crear mesa activa, mesa inactiva, categoría y productos activo/inactivo
    t_active = client.post(
        "/api/v1/tables",
        headers=headers["admin"],
        json={"code": "M-ACT", "name": "Mesa Activa", "capacity": 4},
    ).json()
    t_inactive = client.post(
        "/api/v1/tables",
        headers=headers["admin"],
        json={"code": "M-INA", "name": "Mesa Inactiva", "capacity": 4, "is_active": False},
    ).json()
    cat = client.post(
        "/api/v1/categories",
        headers=headers["manager"],
        json={"name": "Bebidas", "slug": "bebidas"},
    ).json()
    p_active = client.post(
        "/api/v1/products",
        headers=headers["manager"],
        json={"category_id": cat["id"], "name": "Agua", "sku": "SKU-ACT", "price": "1.50"},
    ).json()
    p_inactive = client.post(
        "/api/v1/products",
        headers=headers["manager"],
        json={
            "category_id": cat["id"],
            "name": "Producto Retirado",
            "sku": "SKU-INA",
            "price": "5.00",
            "is_active": False,
        },
    ).json()

    # GET /tables sin auth: solo activas; ?only_active=false bloqueado (401/403)
    anon_tables = client.get("/api/v1/tables")
    assert anon_tables.status_code == 200
    assert [t["id"] for t in anon_tables.json()] == [t_active["id"]]
    assert client.get("/api/v1/tables?only_active=false").status_code == 401
    assert (
        client.get("/api/v1/tables?only_active=false", headers=headers["customer"]).status_code
        == 403
    )

    for role in ("staff", "manager", "admin"):
        all_tables = client.get("/api/v1/tables?only_active=false", headers=headers[role])
        assert all_tables.status_code == 200
        assert len(all_tables.json()) == 2

    # GET /tables/{table_id} requiere autenticación y oculta inactivas a customer
    assert client.get(f"/api/v1/tables/{t_active['id']}").status_code == 401
    assert (
        client.get(f"/api/v1/tables/{t_active['id']}", headers=headers["customer"]).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/tables/{t_inactive['id']}", headers=headers["customer"]).status_code
        == 404
    )
    for role in ("staff", "manager", "admin"):
        assert (
            client.get(f"/api/v1/tables/{t_inactive['id']}", headers=headers[role]).status_code
            == 200
        )

    # GET /products: anónimo/customer/staff solo ven activos; only_active=false solo manager/admin
    anon_prods = client.get("/api/v1/products")
    assert anon_prods.status_code == 200
    assert [p["id"] for p in anon_prods.json()["items"]] == [p_active["id"]]
    assert client.get("/api/v1/products?only_active=false").status_code == 401
    assert (
        client.get("/api/v1/products?only_active=false", headers=headers["customer"]).status_code
        == 403
    )
    assert (
        client.get("/api/v1/products?only_active=false", headers=headers["staff"]).status_code
        == 403
    )
    for role in ("manager", "admin"):
        mgr_prods = client.get("/api/v1/products?only_active=false", headers=headers[role])
        assert mgr_prods.status_code == 200
        assert {p["id"] for p in mgr_prods.json()["items"]} == {p_active["id"], p_inactive["id"]}


def test_integrity_error_translation_and_unexpected_error_propagation(
    store: InMemoryStore,
) -> None:
    admin = store.seed_user(role_code="admin", email="admin@example.com", full_name="Admin")
    cat = FakeCatalogRepo(store).create_category(
        Category(name="Base", slug="base", display_order=1, is_active=True)
    )
    prod = FakeCatalogRepo(store).create_product(
        Product(
            category_id=cat.id,
            name="Plato",
            sku="SKU-1",
            price=Decimal("10.00"),
            preparation_minutes=10,
            is_available=True,
            is_active=True,
        )
    )
    table = FakeTableRepo(store).create(
        RestaurantTable(code="M-1", name="Mesa 1", capacity=4, location="Salón", is_active=True)
    )

    cat_svc = CatalogService(FakeCatalogRepo(store))  # type: ignore[arg-type]
    tbl_svc = TableService(FakeTableRepo(store))  # type: ignore[arg-type]
    usr_svc = UserService(FakeUserRepo(store))  # type: ignore[arg-type]
    auth_svc = AuthService(FakeUserRepo(store))  # type: ignore[arg-type]

    operations = [
        lambda: cat_svc.create_category(CategoryCreate(name="Otra", slug="otra")),
        lambda: cat_svc.update_category(cat.id, CategoryUpdate(name="Base 2")),
        lambda: cat_svc.create_product(
            ProductCreate(category_id=cat.id, name="P2", sku="SKU-2", price=Decimal("5.00"))
        ),
        lambda: cat_svc.update_product(prod.id, ProductUpdate(name="Plato 2")),
        lambda: tbl_svc.create_table(TableCreate(code="M-2", name="Mesa 2", capacity=2)),
        lambda: tbl_svc.update_table(table.id, TableUpdate(name="Mesa 1B")),
        lambda: usr_svc.create_user(
            UserCreate(
                full_name="Nuevo",
                email="nuevo@example.com",
                password="Password123!",
                role_code="customer",
            )
        ),
        lambda: usr_svc.update_user(admin.id, UserUpdate(full_name="Admin 2"), admin),
        lambda: auth_svc.register(
            RegisterRequest(full_name="Reg", email="reg@example.com", password="Password123!")
        ),
    ]

    for op in operations:
        prev_rollbacks = store.db.rolled_back
        store.db.fail_next_commit_integrity = True
        with pytest.raises(ConflictError) as exc_info:
            op()
        assert store.db.rolled_back == prev_rollbacks + 1
        assert "uq_reservations_no_overlap" not in exc_info.value.message
        assert "INSERT" not in exc_info.value.message

    # Errores inesperados no deben convertirse en ConflictError
    def _boom_commit() -> None:
        raise RuntimeError("unexpected db failure")

    orig_commit = store.db.commit
    store.db.commit = _boom_commit  # type: ignore[method-assign]
    try:
        with pytest.raises(RuntimeError, match="unexpected db failure"):
            tbl_svc.update_table(table.id, TableUpdate(name="Boom"))
    finally:
        store.db.commit = orig_commit  # type: ignore[method-assign]


def test_jwt_algorithm_allowlist_in_config_and_tokens(
    api_context: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for invalid_alg in ("none", "NONE", "RS256", "HS1"):
        with pytest.raises(ValidationError):
            Settings(JWT_ALGORITHM=invalid_alg, JWT_SECRET_KEY="a" * 32)

        bad_settings = Settings.model_construct(
            APP_ENV="test",
            JWT_ALGORITHM=invalid_alg,
            JWT_SECRET_KEY="a" * 32,
        )
        with pytest.raises(RuntimeError, match="JWT_ALGORITHM"):
            bad_settings.validate_runtime_security()

    # Entorno producción también rechaza algoritmo inválido sin filtrar JWT_SECRET_KEY
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_ALGORITHM", "none")
    monkeypatch.setenv("JWT_SECRET_KEY", "super-secret-value-never-to-be-printed")
    get_settings.cache_clear()
    try:
        with pytest.raises(ValidationError) as exc:
            get_settings()
        assert "super-secret-value-never-to-be-printed" not in str(exc.value)
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()

    # Token firmado con HS384 o alg=none debe rechazarse cuando el servidor usa HS256
    settings = get_settings()
    hs384_token = jwt.encode(
        {
            "sub": str(api_context["users"]["customer"].id),
            "role": "customer",
            "type": "access",
            "exp": int((datetime.now(UTC) + timedelta(minutes=30)).timestamp()),
        },
        settings.JWT_SECRET_KEY,
        algorithm="HS384",
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(hs384_token)

    alg_none_token = jwt.encode(
        {
            "sub": str(api_context["users"]["customer"].id),
            "role": "customer",
            "type": "access",
            "exp": int((datetime.now(UTC) + timedelta(minutes=30)).timestamp()),
        },
        "",
        algorithm="none",
    )
    assert (
        api_context["client"]
        .get("/api/v1/auth/me", headers={"Authorization": f"Bearer {alg_none_token}"})
        .status_code
        == 401
    )

    valid = create_access_token(api_context["users"]["customer"].id, "customer")
    assert decode_access_token(valid)["role"] == "customer"


def test_order_duplicates_staff_reservation_ownership_and_past_reservation_cancel(
    store: InMemoryStore,
) -> None:
    customer = store.seed_user(role_code="customer", email="cust@example.com", full_name="Cliente")
    staff = store.seed_user(role_code="staff", email="staff@example.com", full_name="Staff")
    admin = store.seed_user(role_code="admin", email="admin@example.com", full_name="Admin")

    cat = FakeCatalogRepo(store).create_category(
        Category(name="Platos", slug="platos", display_order=1, is_active=True)
    )
    prod = FakeCatalogRepo(store).create_product(
        Product(
            category_id=cat.id,
            name="Seco de Pollo",
            sku="PL-10",
            price=Decimal("10.00"),
            preparation_minutes=15,
            is_available=True,
            is_active=True,
        )
    )
    table = FakeTableRepo(store).create(
        RestaurantTable(code="M-5", name="Mesa 5", capacity=4, location="Salón", is_active=True)
    )

    notif_svc = NotificationService(FakeNotificationRepo(store))  # type: ignore[arg-type]
    res_svc = ReservationService(
        FakeReservationRepo(store),  # type: ignore[arg-type]
        FakeTableRepo(store),  # type: ignore[arg-type]
        notif_svc,
    )
    ord_svc = OrderService(
        FakeOrderRepo(store),  # type: ignore[arg-type]
        FakeCatalogRepo(store),  # type: ignore[arg-type]
        FakeTableRepo(store),  # type: ignore[arg-type]
        FakeReservationRepo(store),  # type: ignore[arg-type]
        notif_svc,
    )

    # 1. OrderCreate rechaza product_id duplicado
    with pytest.raises(ValidationError, match="duplicados"):
        OrderCreate(
            order_type="takeaway",
            items=[
                OrderItemCreate(product_id=prod.id, quantity=2),
                OrderItemCreate(product_id=prod.id, quantity=3),
            ],
        )

    # Bypass Pydantic con model_construct también rechazado en OrderService
    raw_dup_order = OrderCreate.model_construct(
        order_type="takeaway",
        table_id=None,
        reservation_id=None,
        notes=None,
        items=[
            OrderItemCreate(product_id=prod.id, quantity=2),
            OrderItemCreate(product_id=prod.id, quantity=3),
        ],
    )
    with pytest.raises(BusinessRuleError, match="duplicados"):
        ord_svc.create_order(raw_dup_order, customer)

    # 2. Staff crea pedido vinculado a reserva de cliente -> cliente es propietario del pedido
    future_res = res_svc.create_reservation(
        ReservationCreate(
            table_id=table.id,
            customer_name="Cliente",
            customer_email="cust@example.com",
            customer_phone="0999999999",
            party_size=2,
            start_time=datetime.now(UTC) + timedelta(hours=3),
            end_time=datetime.now(UTC) + timedelta(hours=5),
        ),
        customer,
    )
    staff_order = ord_svc.create_order(
        OrderCreate(
            order_type="dine_in",
            reservation_id=future_res.id,
            items=[OrderItemCreate(product_id=prod.id, quantity=2)],
        ),
        staff,
    )
    assert staff_order.user_id == customer.id
    customer_orders, total = ord_svc.list_orders(actor=customer)
    assert total == 1 and customer_orders[0].id == staff_order.id

    # 3. Notificación creada pertenece al cliente; ni admin puede marcarla leída (404)
    cust_notifs, _ = notif_svc.list_user_notifications(user_id=customer.id)
    assert len(cust_notifs) >= 1
    with pytest.raises(NotFoundError):
        notif_svc.mark_as_read(cust_notifs[0].id, admin)
    with pytest.raises(NotFoundError):
        notif_svc.mark_as_read(uuid4(), customer)
    marked_own = notif_svc.mark_as_read(cust_notifs[0].id, customer)
    assert marked_own.is_read is True

    # 4. Reserva pasada no puede cancelarse; sí puede marcarse no_show / completed por staff
    past_res = res_svc.create_reservation(
        ReservationCreate(
            table_id=table.id,
            customer_name="Cliente Pasado",
            customer_email="cust@example.com",
            customer_phone="0999999999",
            party_size=2,
            start_time=datetime.now(UTC) - timedelta(hours=3),
            end_time=datetime.now(UTC) - timedelta(hours=1),
        ),
        customer,
    )
    with pytest.raises(BusinessRuleError, match="ya ha pasado"):
        res_svc.update_status(past_res.id, "cancelled", customer)
    with pytest.raises(BusinessRuleError, match="ya ha pasado"):
        res_svc.update_status(past_res.id, "cancelled", staff)

    marked_no_show = res_svc.update_status(past_res.id, "no_show", staff)
    assert marked_no_show.status == "no_show"
    with pytest.raises(BusinessRuleError):
        res_svc.update_status(past_res.id, "cancelled", staff)

    # Reserva futura confirmada sí puede cancelarse
    cancelled_future = res_svc.update_status(future_res.id, "cancelled", customer)
    assert cancelled_future.status == "cancelled"
    with pytest.raises(BusinessRuleError):
        res_svc.update_status(future_res.id, "cancelled", customer)
