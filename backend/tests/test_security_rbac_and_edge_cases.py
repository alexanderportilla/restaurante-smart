from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.api.dependencies import require_permissions
from app.core.config import get_settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import create_access_token, decode_access_token
from app.models.auth import User
from app.schemas.reservations import ReservationUpdate
from app.services.notification_service import NotificationService
from app.services.reservation_service import ReservationService
from tests.conftest import (
    FakeNotificationRepo,
    FakeReservationRepo,
    FakeTableRepo,
    InMemoryStore,
)


def _create_table_and_catalog(client: TestClient, headers_admin: dict[str, str]) -> dict[str, Any]:
    t1 = client.post(
        "/api/v1/tables",
        headers=headers_admin,
        json={
            "code": "  M01  ",
            "name": "  Mesa Ventana  ",
            "capacity": 4,
            "location": " Sal\u00f3n ",
        },
    )
    assert t1.status_code == 201
    t2 = client.post(
        "/api/v1/tables",
        headers=headers_admin,
        json={"code": "M02", "name": "Mesa Jard\u00edn", "capacity": 2, "location": "Terraza"},
    )
    assert t2.status_code == 201

    c1 = client.post(
        "/api/v1/categories",
        headers=headers_admin,
        json={
            "name": "  Entradas  ",
            "slug": "entradas",
            "description": "  Fr\u00edas  ",
            "sort_order": 1,
        },
    )
    assert c1.status_code == 201
    c2 = client.post(
        "/api/v1/categories",
        headers=headers_admin,
        json={"name": "Bebidas", "slug": "bebidas", "description": "Sin alcohol", "sort_order": 2},
    )
    assert c2.status_code == 201

    p1 = client.post(
        "/api/v1/products",
        headers=headers_admin,
        json={
            "category_id": c1.json()["id"],
            "name": "Ceviche Cl\u00e1sico",
            "sku": "SKU-CEV-01",
            "price": "12.50",
            "is_available": True,
        },
    )
    assert p1.status_code == 201
    p2 = client.post(
        "/api/v1/products",
        headers=headers_admin,
        json={
            "category_id": c2.json()["id"],
            "name": "Limonada",
            "sku": "SKU-LIM-01",
            "price": "3.25",
            "is_available": True,
        },
    )
    assert p2.status_code == 201

    return {
        "tables": [t1.json(), t2.json()],
        "categories": [c1.json(), c2.json()],
        "products": [p1.json(), p2.json()],
    }


def test_jwt_security_invalid_expired_wrong_type_and_bad_sub() -> None:
    settings = get_settings()
    user_id = uuid4()

    expired = jwt.encode(
        {
            "sub": str(user_id),
            "role": "customer",
            "type": "access",
            "iat": int((datetime.now(UTC) - timedelta(hours=2)).timestamp()),
            "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp()),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(expired)

    wrong_secret = jwt.encode(
        {
            "sub": str(user_id),
            "role": "admin",
            "type": "access",
            "exp": int((datetime.now(UTC) + timedelta(minutes=30)).timestamp()),
        },
        "completely-different-secret-key-at-least-32-chars",
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(wrong_secret)

    wrong_type = jwt.encode(
        {
            "sub": str(user_id),
            "role": "customer",
            "type": "refresh",
            "exp": int((datetime.now(UTC) + timedelta(minutes=30)).timestamp()),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(wrong_type)

    bad_sub = create_access_token("not-a-uuid", "customer")  # type: ignore[arg-type]
    assert decode_access_token(bad_sub)["sub"] == "not-a-uuid"


def test_auth_inactive_user_deleted_user_and_password_hash_never_exposed(
    api_context: dict[str, Any],
) -> None:
    client: TestClient = api_context["client"]
    store: InMemoryStore = api_context["store"]
    headers = api_context["headers"]
    users = api_context["users"]

    # Token con UUID inexistente -> 401
    ghost_token = create_access_token(uuid4(), "customer")
    res_ghost = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {ghost_token}"})
    assert res_ghost.status_code == 401

    # Usuario inactivo -> no puede acceder con token ni iniciar sesi\u00f3n
    customer2 = store.seed_user(
        role_code="customer",
        email="inactivo@example.com",
        full_name="Inactivo",
        raw_secret="SecretPass123!",
    )
    customer2_token = create_access_token(customer2.id, "customer")
    customer2.is_active = False

    res_me_inactive = client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {customer2_token}"}
    )
    assert res_me_inactive.status_code == 403

    res_login_inactive = client.post(
        "/api/v1/auth/login",
        json={"email": "inactivo@example.com", "password": "SecretPass123!"},
    )
    assert res_login_inactive.status_code == 403

    # Nunca exponer password_hash en /auth/me, /users ni /users/{id}
    me = client.get("/api/v1/auth/me", headers=headers["customer"])
    assert me.status_code == 200
    assert "password_hash" not in me.json()

    users_list = client.get("/api/v1/users", headers=headers["admin"])
    assert users_list.status_code == 200
    assert all("password_hash" not in item for item in users_list.json()["items"])

    user_detail = client.get(f"/api/v1/users/{users['customer'].id}", headers=headers["manager"])
    assert user_detail.status_code == 200
    assert "password_hash" not in user_detail.json()


def test_require_permissions_dependency_and_unhandled_500_masking(
    api_context: dict[str, Any],
) -> None:
    app = api_context["app"]
    headers = api_context["headers"]

    @app.get("/api/v1/_test-perm-reports")
    def _perm_probe(
        current_user: User = Depends(require_permissions("reports:read", "users:write")),
    ) -> dict[str, str]:
        return {"ok": current_user.role.code}

    @app.get("/api/v1/_test-boom")
    def _boom_probe() -> dict[str, str]:
        raise RuntimeError("sensitive internal connection detail: secret-dsn")

    with TestClient(app, raise_server_exceptions=False) as isolated_client:
        # manager tiene reports:read pero NO users:write -> 403
        assert (
            isolated_client.get(
                "/api/v1/_test-perm-reports", headers=headers["manager"]
            ).status_code
            == 403
        )
        # staff no tiene ninguno -> 403
        assert (
            isolated_client.get("/api/v1/_test-perm-reports", headers=headers["staff"]).status_code
            == 403
        )
        # admin tiene ambos -> 200
        ok_res = isolated_client.get("/api/v1/_test-perm-reports", headers=headers["admin"])
        assert ok_res.status_code == 200
        assert ok_res.json()["ok"] == "admin"

        # 500 controlado nunca filtra mensaje interno ni stack trace
        err_res = isolated_client.get("/api/v1/_test-boom")
        assert err_res.status_code == 500
        body = err_res.json()
        assert body["error"]["code"] == "INTERNAL_SERVER_ERROR"
        assert "secret-dsn" not in err_res.text
        assert "Traceback" not in err_res.text


def test_admin_self_lockout_and_rbac_negative_matrix(api_context: dict[str, Any]) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]
    users = api_context["users"]

    admin_id = users["admin"].id
    customer_id = users["customer"].id

    # Admin no puede desactivarse ni degradar su propio rol
    res_self_deactivate = client.patch(
        f"/api/v1/users/{admin_id}",
        headers=headers["admin"],
        json={"is_active": False},
    )
    assert res_self_deactivate.status_code == 422

    res_self_demote = client.patch(
        f"/api/v1/users/{admin_id}",
        headers=headers["admin"],
        json={"role_code": "customer"},
    )
    assert res_self_demote.status_code == 422

    # Admin s\u00ed puede actualizar su nombre manteniendo mismo rol
    res_self_ok = client.patch(
        f"/api/v1/users/{admin_id}",
        headers=headers["admin"],
        json={"full_name": "Admin Actualizado", "role_code": "admin"},
    )
    assert res_self_ok.status_code == 200
    assert res_self_ok.json()["full_name"] == "Admin Actualizado"

    # Matriz negativa RBAC por endpoint sensible
    assert client.get("/api/v1/users", headers=headers["staff"]).status_code == 403
    assert client.get("/api/v1/users", headers=headers["customer"]).status_code == 403
    assert (
        client.patch(
            f"/api/v1/users/{customer_id}",
            headers=headers["customer"],
            json={"role_code": "admin"},
        ).status_code
        == 403
    )
    assert client.get("/api/v1/reports/summary", headers=headers["staff"]).status_code == 403
    assert client.get("/api/v1/reports/summary", headers=headers["customer"]).status_code == 403
    assert client.get("/api/v1/reports/summary", headers=headers["manager"]).status_code == 200


def test_tables_get_by_id_and_catalog_duplicate_checks_on_update(
    api_context: dict[str, Any],
) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]
    seeded = _create_table_and_catalog(client, headers["admin"])
    t1, _t2 = seeded["tables"]
    c1, c2 = seeded["categories"]
    p1, p2 = seeded["products"]

    # Normalizaci\u00f3n de espacios al crear mesa + nuevo GET /tables/{id}
    assert t1["code"] == "M01"
    assert t1["name"] == "Mesa Ventana"
    assert t1["location"] == "Sal\u00f3n"

    get_t1 = client.get(f"/api/v1/tables/{t1['id']}", headers=headers["customer"])
    assert get_t1.status_code == 200
    assert get_t1.json()["code"] == "M01"

    assert client.get("/api/v1/tables/999999", headers=headers["admin"]).status_code == 404

    # Staff/customer no pueden crear/modificar mesas ni cat\u00e1logo
    assert (
        client.post(
            "/api/v1/tables",
            headers=headers["staff"],
            json={"code": "M99", "name": "Extra", "capacity": 2},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/categories",
            headers=headers["customer"],
            json={"name": "Postres", "slug": "postres"},
        ).status_code
        == 403
    )

    # Colisi\u00f3n de slug o nombre al actualizar categor\u00eda -> 409
    dup_slug = client.patch(
        f"/api/v1/categories/{c1['id']}",
        headers=headers["manager"],
        json={"slug": c2["slug"]},
    )
    assert dup_slug.status_code == 409

    dup_name = client.patch(
        f"/api/v1/categories/{c1['id']}",
        headers=headers["manager"],
        json={"name": c2["name"]},
    )
    assert dup_name.status_code == 409

    # Actualizar la misma categor\u00eda manteniendo su propio slug -> 200
    same_cat = client.patch(
        f"/api/v1/categories/{c1['id']}",
        headers=headers["manager"],
        json={"slug": c1["slug"], "description": "  Actualizada  "},
    )
    assert same_cat.status_code == 200
    assert same_cat.json()["description"] == "Actualizada"

    # Colisi\u00f3n de SKU al actualizar producto -> 409
    dup_sku = client.patch(
        f"/api/v1/products/{p1['id']}",
        headers=headers["manager"],
        json={"sku": p2["sku"]},
    )
    assert dup_sku.status_code == 409

    # Categor\u00eda inexistente al actualizar producto -> 404
    bad_cat = client.patch(
        f"/api/v1/products/{p1['id']}",
        headers=headers["manager"],
        json={"category_id": 999999},
    )
    assert bad_cat.status_code == 404


def test_reservation_patch_overlap_terminal_and_rollback(api_context: dict[str, Any]) -> None:
    client: TestClient = api_context["client"]
    store: InMemoryStore = api_context["store"]
    headers = api_context["headers"]
    seeded = _create_table_and_catalog(client, headers["admin"])
    t1, t2 = seeded["tables"]

    start_a = datetime(2027, 6, 15, 19, 0, tzinfo=UTC)
    end_a = datetime(2027, 6, 15, 21, 0, tzinfo=UTC)
    start_b = datetime(2027, 6, 15, 21, 30, tzinfo=UTC)
    end_b = datetime(2027, 6, 15, 23, 0, tzinfo=UTC)

    r1 = client.post(
        "/api/v1/reservations",
        headers=headers["customer"],
        json={
            "table_id": t1["id"],
            "customer_name": "Cliente Uno",
            "customer_email": "cliente@example.com",
            "customer_phone": "0999999999",
            "party_size": 2,
            "start_time": start_a.isoformat(),
            "end_time": end_a.isoformat(),
            "notes": "Mesa tranquila",
        },
    )
    assert r1.status_code == 201
    r1_id = r1.json()["id"]

    r2 = client.post(
        "/api/v1/reservations",
        headers=headers["staff"],
        json={
            "table_id": t1["id"],
            "customer_name": "Otro Cliente",
            "customer_email": "otro@example.com",
            "customer_phone": "0988888888",
            "party_size": 3,
            "start_time": start_b.isoformat(),
            "end_time": end_b.isoformat(),
        },
    )
    assert r2.status_code == 201
    r2_id = r2.json()["id"]

    # Deslizar franja de r1 sobre s\u00ed misma (no solapa con r2) -> 200 y genera notificaci\u00f3n
    res_slide = client.patch(
        f"/api/v1/reservations/{r1_id}",
        headers=headers["customer"],
        json={
            "start_time": (start_a + timedelta(minutes=15)).isoformat(),
            "end_time": (end_a + timedelta(minutes=15)).isoformat(),
            "notes": "Actualizada por cliente",
        },
    )
    assert res_slide.status_code == 200
    assert res_slide.json()["notes"] == "Actualizada por cliente"

    # Otro customer no puede modificar reserva ajena -> 403
    other_customer = store.seed_user(
        role_code="customer", email="otro.cliente@example.com", full_name="Otro"
    )
    other_headers = {
        "Authorization": f"Bearer {create_access_token(other_customer.id, 'customer')}"
    }
    assert (
        client.patch(
            f"/api/v1/reservations/{r1_id}",
            headers=other_headers,
            json={"notes": "Intento indebido"},
        ).status_code
        == 403
    )

    # Mover r1 al horario ocupado de r2 -> 409 Conflict
    res_overlap = client.patch(
        f"/api/v1/reservations/{r1_id}",
        headers=headers["customer"],
        json={
            "start_time": start_b.isoformat(),
            "end_time": end_b.isoformat(),
        },
    )
    assert res_overlap.status_code == 409

    # Exceder capacidad al cambiar a mesa t2 (capacidad 2, party_size=3 en r2) -> 422
    res_cap = client.patch(
        f"/api/v1/reservations/{r2_id}",
        headers=headers["staff"],
        json={"table_id": t2["id"]},
    )
    assert res_cap.status_code == 422

    # Cancelar r1 e intentar editarla -> 422 terminal status guard
    cancel_r1 = client.patch(
        f"/api/v1/reservations/{r1_id}/status",
        headers=headers["customer"],
        json={"status": "cancelled"},
    )
    assert cancel_r1.status_code == 200

    res_terminal = client.patch(
        f"/api/v1/reservations/{r1_id}",
        headers=headers["admin"],
        json={"notes": "Despu\u00e9s de cancelar"},
    )
    assert res_terminal.status_code == 422

    # Rollback si commit falla por IntegrityError en update_reservation
    service = ReservationService(
        reservation_repo=FakeReservationRepo(store),  # type: ignore[arg-type]
        table_repo=FakeTableRepo(store),  # type: ignore[arg-type]
        notification_service=NotificationService(FakeNotificationRepo(store)),  # type: ignore[arg-type]
    )
    store.db.fail_next_commit_integrity = True
    prev_rollbacks = store.db.rolled_back
    with pytest.raises(ConflictError):
        service.update_reservation(
            reservation_id=UUID(str(r2_id)),
            payload=ReservationUpdate(notes="Falla DB"),
            actor=api_context["users"]["staff"],
        )
    assert store.db.rolled_back == prev_rollbacks + 1


def test_order_reservation_consistency_pricing_and_notifications(
    api_context: dict[str, Any],
) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]
    seeded = _create_table_and_catalog(client, headers["admin"])
    t1, t2 = seeded["tables"]
    p1, p2 = seeded["products"]

    # Crear dos reservas para customer: una activa en t1 y otra luego cancelada
    r_active = client.post(
        "/api/v1/reservations",
        headers=headers["customer"],
        json={
            "table_id": t1["id"],
            "customer_name": "Cliente Pedido",
            "customer_email": "cliente@example.com",
            "customer_phone": "0999999999",
            "party_size": 2,
            "start_time": datetime(2027, 7, 1, 18, 0, tzinfo=UTC).isoformat(),
            "end_time": datetime(2027, 7, 1, 20, 0, tzinfo=UTC).isoformat(),
        },
    )
    assert r_active.status_code == 201
    r_active_id = r_active.json()["id"]

    r_cancelled = client.post(
        "/api/v1/reservations",
        headers=headers["customer"],
        json={
            "table_id": t2["id"],
            "customer_name": "Cliente Cancelada",
            "customer_email": "cliente@example.com",
            "customer_phone": "0999999999",
            "party_size": 2,
            "start_time": datetime(2027, 7, 1, 18, 0, tzinfo=UTC).isoformat(),
            "end_time": datetime(2027, 7, 1, 20, 0, tzinfo=UTC).isoformat(),
        },
    )
    assert r_cancelled.status_code == 201
    r_cancelled_id = r_cancelled.json()["id"]
    assert (
        client.patch(
            f"/api/v1/reservations/{r_cancelled_id}/status",
            headers=headers["customer"],
            json={"status": "cancelled"},
        ).status_code
        == 200
    )

    # 1. Pedido asociado a reserva cancelada -> 422
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers["customer"],
            json={
                "reservation_id": r_cancelled_id,
                "items": [{"product_id": p1["id"], "quantity": 1}],
            },
        ).status_code
        == 422
    )

    # 2. Pedido con mesa distinta a la de la reserva -> 422
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers["customer"],
            json={
                "table_id": t2["id"],
                "reservation_id": r_active_id,
                "items": [{"product_id": p1["id"], "quantity": 1}],
            },
        ).status_code
        == 422
    )

    # 3. Cantidades inv\u00e1lidas (0 y >100) -> 422
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers["customer"],
            json={"items": [{"product_id": p1["id"], "quantity": 0}]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers["customer"],
            json={"items": [{"product_id": p1["id"], "quantity": 101}]},
        ).status_code
        == 422
    )

    # 4. Producto no disponible -> 422
    assert (
        client.patch(
            f"/api/v1/products/{p2['id']}",
            headers=headers["manager"],
            json={"is_available": False},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers["customer"],
            json={"items": [{"product_id": p2["id"], "quantity": 1}]},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/v1/products/{p2['id']}",
            headers=headers["manager"],
            json={"is_available": True},
        ).status_code
        == 200
    )

    # 5. Pedido multi-\u00edtem hereda table_id de la reserva y calcula impuestos con precisi\u00f3n
    order_res = client.post(
        "/api/v1/orders",
        headers=headers["customer"],
        json={
            "reservation_id": r_active_id,
            "items": [
                {"product_id": p1["id"], "quantity": 2},
                {"product_id": p2["id"], "quantity": 3},
            ],
        },
    )
    assert order_res.status_code == 201
    order_body = order_res.json()
    assert order_body["table_id"] == t1["id"]

    expected_subtotal = Decimal("12.50") * 2 + Decimal("3.25") * 3  # 34.75
    tax_rate = Decimal(str(get_settings().TAX_RATE))
    expected_tax = (expected_subtotal * tax_rate).quantize(Decimal("0.01"))
    expected_total = (expected_subtotal + expected_tax).quantize(Decimal("0.01"))
    assert Decimal(str(order_body["subtotal"])) == expected_subtotal
    assert Decimal(str(order_body["tax_amount"])) == expected_tax
    assert Decimal(str(order_body["total_amount"])) == expected_total

    # 6. Reglas de transicion y RBAC de estados de pedido
    order_id = order_body["id"]
    assert (
        client.patch(
            f"/api/v1/orders/{order_id}/status",
            headers=headers["customer"],
            json={"status_code": "confirmed"},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/orders/{order_id}/status",
            headers=headers["staff"],
            json={"status_code": "delivered"},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/v1/orders/{order_id}/status",
            headers=headers["staff"],
            json={"status_code": "confirmed"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/orders/{order_id}/status",
            headers=headers["customer"],
            json={"status_code": "cancelled"},
        ).status_code
        == 403
    )
    pending_order = client.post(
        "/api/v1/orders",
        headers=headers["customer"],
        json={"items": [{"product_id": p1["id"], "quantity": 1}]},
    )
    assert pending_order.status_code == 201
    assert (
        client.patch(
            f"/api/v1/orders/{pending_order.json()['id']}/status",
            headers=headers["customer"],
            json={"status_code": "cancelled"},
        ).status_code
        == 200
    )

    # 7. Notificaciones privadas (ningún tercero puede marcar ajenas; 404 oculta existencia)
    notif_res = client.get("/api/v1/notifications", headers=headers["customer"])
    assert notif_res.status_code == 200
    assert notif_res.json()["total"] >= 2
    notif_id = notif_res.json()["items"][0]["id"]
    for other_role in ("staff", "manager", "admin"):
        assert (
            client.patch(
                f"/api/v1/notifications/{notif_id}/read", headers=headers[other_role]
            ).status_code
            == 404
        )
    read_res = client.patch(f"/api/v1/notifications/{notif_id}/read", headers=headers["customer"])
    assert read_res.status_code == 200
    assert read_res.json()["is_read"] is True


def test_postgres_integration_requires_isolated_test_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_full_flows_postgres import _get_isolated_test_database_url as full_flow_url
    from tests.test_postgres_integration import _get_isolated_test_database_url as integ_url

    monkeypatch.setenv("RUN_POSTGRES_TESTS", "1")
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    assert full_flow_url() is None
    assert integ_url() is None

    monkeypatch.setenv(
        "TEST_DATABASE_URL", "postgresql+psycopg://user:pass@localhost:5432/restaurante_smart_test"
    )
    assert full_flow_url() == "postgresql+psycopg://user:pass@localhost:5432/restaurante_smart_test"
    assert integ_url() == "postgresql+psycopg://user:pass@localhost:5432/restaurante_smart_test"
