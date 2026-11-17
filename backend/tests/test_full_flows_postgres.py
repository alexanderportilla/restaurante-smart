import os
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from app.models.auth import User
from app.models.orders import Notification, Order, OrderItem
from app.models.restaurant import Category, Product, Reservation, RestaurantTable
from app.repositories.user_repository import UserRepository
from tests.conftest import (
    apply_isolated_postgres_test_env,
    assert_isolated_postgres_test_env,
)


def _get_isolated_test_database_url() -> str | None:
    if os.getenv("RUN_POSTGRES_TESTS") != "1":
        return None
    test_db_url = os.getenv("TEST_DATABASE_URL", "").strip()
    return test_db_url or None


pytestmark = pytest.mark.skipif(
    _get_isolated_test_database_url() is None,
    reason=(
        "Pruebas reales contra PostgreSQL desactivadas "
        "(establecer RUN_POSTGRES_TESTS=1 y TEST_DATABASE_URL aislada)."
    ),
)


@pytest.fixture(autouse=True)
def _use_isolated_postgres_url(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_isolated_postgres_test_env(monkeypatch)


def test_full_http_flows_against_real_postgresql() -> None:
    """Valida extremo a extremo los 9 flujos completos contra PostgreSQL 17.12."""
    assert_isolated_postgres_test_env()
    get_settings.cache_clear()
    get_engine.cache_clear()
    session_factory = get_session_factory()
    suffix = uuid4().hex[:8]

    created_user_ids: list[UUID] = []
    created_table_ids: list[int] = []
    created_category_ids: list[int] = []
    created_product_ids: list[int] = []
    created_reservation_ids: list[UUID] = []
    created_order_ids: list[UUID] = []

    try:
        # Sembrar usuarios admin/manager/staff temporales en BD real
        with session_factory() as db:
            user_repo = UserRepository(db)
            for role_code in ("admin", "manager", "staff"):
                role = user_repo.get_role_by_code(role_code)
                assert role is not None
                u = user_repo.create(
                    User(
                        role_id=role.id,
                        full_name=f"{role_code.title()} E2E {suffix}",
                        email=f"{role_code}_e2e_{suffix}@example.com",
                        phone="0991110000",
                        password_hash=hash_password("E2eSecret123!"),
                        is_active=True,
                    )
                )
                created_user_ids.append(u.id)
            db.commit()

        app = create_app()
        with TestClient(app) as client:
            # 1. Registro público de cliente + login + /auth/me + rechazo sin token
            assert client.get("/api/v1/auth/me").status_code == 401

            customer_email = f"cust_e2e_{suffix}@example.com"
            reg = client.post(
                "/api/v1/auth/register",
                json={
                    "full_name": f"Cliente E2E {suffix}",
                    "email": customer_email,
                    "phone": "0992223333",
                    "password": "E2eSecret123!",
                },
            )
            assert reg.status_code == 201
            customer_id = UUID(reg.json()["id"])
            created_user_ids.append(customer_id)
            assert reg.json()["role_code"] == "customer"

            def login_as(email: str) -> dict[str, str]:
                res = client.post(
                    "/api/v1/auth/login",
                    json={"email": email, "password": "E2eSecret123!"},
                )
                assert res.status_code == 200
                return {"Authorization": f"Bearer {res.json()['access_token']}"}

            admin_h = login_as(f"admin_e2e_{suffix}@example.com")
            manager_h = login_as(f"manager_e2e_{suffix}@example.com")
            staff_h = login_as(f"staff_e2e_{suffix}@example.com")
            customer_h = login_as(customer_email)

            me = client.get("/api/v1/auth/me", headers=customer_h)
            assert me.status_code == 200
            assert me.json()["email"] == customer_email

            # 2. RBAC y gestión de usuarios/roles
            assert client.get("/api/v1/users", headers=customer_h).status_code == 403
            assert client.get("/api/v1/roles", headers=admin_h).status_code == 200

            new_user = client.post(
                "/api/v1/users",
                headers=admin_h,
                json={
                    "full_name": f"Extra Staff {suffix}",
                    "email": f"extra_{suffix}@example.com",
                    "password": "E2eSecret123!",
                    "role_code": "staff",
                    "is_active": True,
                },
            )
            assert new_user.status_code == 201
            created_user_ids.append(UUID(new_user.json()["id"]))

            # 3. Categorías y productos (CRUD + filtros)
            cat = client.post(
                "/api/v1/categories",
                headers=manager_h,
                json={
                    "name": f"Bebidas {suffix}",
                    "slug": f"bebidas-{suffix}",
                    "display_order": 2,
                },
            )
            assert cat.status_code == 201
            cat_id = cat.json()["id"]
            created_category_ids.append(cat_id)

            prod = client.post(
                "/api/v1/products",
                headers=manager_h,
                json={
                    "category_id": cat_id,
                    "name": f"Jugo Natural {suffix}",
                    "sku": f"BEB-{suffix[:6]}",
                    "price": "4.50",
                    "preparation_minutes": 5,
                },
            )
            assert prod.status_code == 201
            prod_id = prod.json()["id"]
            created_product_ids.append(prod_id)

            search_res = client.get(
                "/api/v1/products",
                params={"category_id": cat_id, "search": "Jugo"},
            )
            assert search_res.status_code == 200
            assert search_res.json()["total"] == 1

            # 4. Mesas y disponibilidad
            table = client.post(
                "/api/v1/tables",
                headers=manager_h,
                json={
                    "code": f"E2E-{suffix[:5]}",
                    "name": f"Mesa E2E {suffix}",
                    "capacity": 4,
                    "location": "Salón Principal",
                },
            )
            assert table.status_code == 201
            table_id = table.json()["id"]
            created_table_ids.append(table_id)

            start_iso = datetime(2026, 12, 22, 20, 0, tzinfo=UTC).isoformat()
            end_iso = datetime(2026, 12, 22, 22, 0, tzinfo=UTC).isoformat()

            avail1 = client.get(
                "/api/v1/availability",
                params={"start_time": start_iso, "end_time": end_iso, "party_size": 4},
            )
            assert avail1.status_code == 200
            assert any(t["id"] == table_id for t in avail1.json()["available_tables"])

            # 5. Reservas: creación, conflicto 409 por solapamiento, cancelación y re-reserva
            res1 = client.post(
                "/api/v1/reservations",
                headers=customer_h,
                json={
                    "table_id": table_id,
                    "customer_name": f"Cliente E2E {suffix}",
                    "customer_email": customer_email,
                    "customer_phone": "0992223333",
                    "party_size": 4,
                    "start_time": start_iso,
                    "end_time": end_iso,
                },
            )
            assert res1.status_code == 201
            res1_id = UUID(res1.json()["id"])
            created_reservation_ids.append(res1_id)

            res_conflict = client.post(
                "/api/v1/reservations",
                headers=staff_h,
                json={
                    "table_id": table_id,
                    "customer_name": "Choque",
                    "customer_email": f"choque_{suffix}@example.com",
                    "customer_phone": "0990009999",
                    "party_size": 2,
                    "start_time": (datetime(2026, 12, 22, 20, 30, tzinfo=UTC)).isoformat(),
                    "end_time": (datetime(2026, 12, 22, 21, 30, tzinfo=UTC)).isoformat(),
                },
            )
            assert res_conflict.status_code == 409

            cancelled = client.patch(
                f"/api/v1/reservations/{res1_id}/status",
                headers=customer_h,
                json={"status": "cancelled"},
            )
            assert cancelled.status_code == 200
            assert cancelled.json()["status"] == "cancelled"

            res2 = client.post(
                "/api/v1/reservations",
                headers=customer_h,
                json={
                    "table_id": table_id,
                    "customer_name": f"Cliente E2E {suffix}",
                    "customer_email": customer_email,
                    "customer_phone": "0992223333",
                    "party_size": 2,
                    "start_time": start_iso,
                    "end_time": end_iso,
                },
            )
            assert res2.status_code == 201
            res2_id = UUID(res2.json()["id"])
            created_reservation_ids.append(res2_id)

            # 6. Pedidos: cálculo de totales en servidor y ciclo completo de estados
            assert len(client.get("/api/v1/order-statuses").json()) == 6

            order_res = client.post(
                "/api/v1/orders",
                headers=customer_h,
                json={
                    "order_type": "dine_in",
                    "table_id": table_id,
                    "reservation_id": str(res2_id),
                    "items": [{"product_id": prod_id, "quantity": 3}],
                },
            )
            assert order_res.status_code == 201
            order_id = UUID(order_res.json()["id"])
            created_order_ids.append(order_id)
            assert Decimal(order_res.json()["subtotal"]) == Decimal("13.50")
            assert Decimal(order_res.json()["tax_amount"]) == Decimal("1.62")
            assert Decimal(order_res.json()["total_amount"]) == Decimal("15.12")

            for next_status in ("confirmed", "preparing", "ready", "delivered"):
                step = client.patch(
                    f"/api/v1/orders/{order_id}/status",
                    headers=staff_h,
                    json={"status_code": next_status},
                )
                assert step.status_code == 200
                assert step.json()["status"]["code"] == next_status

            # 7. Notificaciones: lectura y marcado como leída
            notifs = client.get("/api/v1/notifications", headers=customer_h)
            assert notifs.status_code == 200
            assert notifs.json()["total"] >= 7
            first_notif = notifs.json()["items"][0]["id"]
            read_res = client.patch(
                f"/api/v1/notifications/{first_notif}/read",
                headers=customer_h,
            )
            assert read_res.status_code == 200
            assert read_res.json()["is_read"] is True

            # 8. Reportes: solo manager/admin
            assert client.get("/api/v1/reports/summary", headers=staff_h).status_code == 403
            summary = client.get("/api/v1/reports/summary", headers=manager_h)
            assert summary.status_code == 200
            assert Decimal(summary.json()["total_revenue"]) >= Decimal("15.12")

            top = client.get("/api/v1/reports/top-products", headers=manager_h)
            assert top.status_code == 200
            assert any(item["product_id"] == prod_id for item in top.json()["items"])

            # Soft-delete de producto y categoría al finalizar flujo
            assert (
                client.delete(f"/api/v1/products/{prod_id}", headers=manager_h).status_code == 204
            )
            assert (
                client.delete(f"/api/v1/categories/{cat_id}", headers=manager_h).status_code == 204
            )
    finally:
        with session_factory() as cleanup_db:
            if created_order_ids:
                cleanup_db.query(OrderItem).filter(
                    OrderItem.order_id.in_(created_order_ids)
                ).delete(synchronize_session=False)
                cleanup_db.query(Order).filter(Order.id.in_(created_order_ids)).delete(
                    synchronize_session=False
                )
            if created_reservation_ids:
                cleanup_db.query(Reservation).filter(
                    Reservation.id.in_(created_reservation_ids)
                ).delete(synchronize_session=False)
            if created_user_ids:
                cleanup_db.query(Notification).filter(
                    Notification.user_id.in_(created_user_ids)
                ).delete(synchronize_session=False)
                cleanup_db.query(User).filter(User.id.in_(created_user_ids)).delete(
                    synchronize_session=False
                )
            if created_product_ids:
                cleanup_db.query(Product).filter(Product.id.in_(created_product_ids)).delete(
                    synchronize_session=False
                )
            if created_category_ids:
                cleanup_db.query(Category).filter(Category.id.in_(created_category_ids)).delete(
                    synchronize_session=False
                )
            if created_table_ids:
                cleanup_db.query(RestaurantTable).filter(
                    RestaurantTable.id.in_(created_table_ids)
                ).delete(synchronize_session=False)
            cleanup_db.commit()
