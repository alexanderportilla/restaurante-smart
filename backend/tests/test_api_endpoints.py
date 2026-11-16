from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import get_db


def test_health_and_openapi(api_context: dict[str, Any]) -> None:
    client: TestClient = api_context["client"]

    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["database"] == "connected"

    schema = client.get("/api/v1/openapi.json")
    assert schema.status_code == 200
    assert "/api/v1/reservations" in schema.json()["paths"]

    # Verifica respuesta 503 cuando la BD falla
    class BrokenDB:
        def execute(self, _stmt: Any) -> None:
            raise SQLAlchemyError("down")

    api_context["app"].dependency_overrides[get_db] = lambda: BrokenDB()
    degraded = client.get("/api/v1/health")
    assert degraded.status_code == 503
    assert degraded.json()["database"] == "unreachable"


def test_auth_and_rbac_endpoints(api_context: dict[str, Any]) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]

    # Sin token -> 401
    assert client.get("/api/v1/auth/me").status_code == 401

    # Registro público -> 201 con rol customer
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Nuevo Cliente",
            "email": "nuevo@example.com",
            "password": "PasswordSegura123!",
        },
    )
    assert reg.status_code == 201
    assert reg.json()["role_code"] == "customer"

    # Login -> 200 con JWT
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "nuevo@example.com", "password": "PasswordSegura123!"},
    )
    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"

    # RBAC: customer no accede a /users ni /reports/summary ni POST /tables
    assert client.get("/api/v1/users", headers=headers["customer"]).status_code == 403
    assert client.get("/api/v1/reports/summary", headers=headers["customer"]).status_code == 403
    assert (
        client.post(
            "/api/v1/tables",
            headers=headers["customer"],
            json={"code": "T1", "name": "Mesa 1", "capacity": 4},
        ).status_code
        == 403
    )

    # Admin accede a /users y /roles
    assert client.get("/api/v1/users", headers=headers["admin"]).status_code == 200
    assert client.get("/api/v1/roles", headers=headers["admin"]).status_code == 200


def test_end_to_end_catalog_tables_reservations_orders_reports(api_context: dict[str, Any]) -> None:
    client: TestClient = api_context["client"]
    headers = api_context["headers"]

    # Manager crea categoría, producto y mesa
    cat_res = client.post(
        "/api/v1/categories",
        headers=headers["manager"],
        json={"name": "Entradas", "slug": "entradas", "display_order": 1},
    )
    assert cat_res.status_code == 201
    cat_id = cat_res.json()["id"]

    prod_res = client.post(
        "/api/v1/products",
        headers=headers["manager"],
        json={
            "category_id": cat_id,
            "name": "Ceviche Clásico",
            "sku": "ENT-001",
            "price": "15.00",
            "preparation_minutes": 15,
        },
    )
    assert prod_res.status_code == 201
    prod_id = prod_res.json()["id"]
    assert client.get(f"/api/v1/products/{prod_id}").status_code == 200

    table_res = client.post(
        "/api/v1/tables",
        headers=headers["manager"],
        json={"code": "M-10", "name": "Mesa VIP", "capacity": 4, "location": "Ventana"},
    )
    assert table_res.status_code == 201
    table_id = table_res.json()["id"]

    start = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    end = (datetime.now(UTC) + timedelta(hours=5)).isoformat()

    avail = client.get(
        "/api/v1/availability",
        params={"start_time": start, "end_time": end, "party_size": 4},
    )
    assert avail.status_code == 200
    assert len(avail.json()["available_tables"]) == 1

    # Cliente crea reserva
    res_create = client.post(
        "/api/v1/reservations",
        headers=headers["customer"],
        json={
            "table_id": table_id,
            "customer_name": "Cliente Smart",
            "customer_email": "cliente@example.com",
            "customer_phone": "099888777",
            "party_size": 4,
            "start_time": start,
            "end_time": end,
        },
    )
    assert res_create.status_code == 201
    reservation_id = res_create.json()["id"]

    # Reserva duplicada en mismo horario -> 409
    res_dup = client.post(
        "/api/v1/reservations",
        headers=headers["staff"],
        json={
            "table_id": table_id,
            "customer_name": "Otro",
            "customer_email": "otro@example.com",
            "customer_phone": "099000111",
            "party_size": 2,
            "start_time": start,
            "end_time": end,
        },
    )
    assert res_dup.status_code == 409

    # Cliente crea pedido en mesa vinculado a su reserva
    order_res = client.post(
        "/api/v1/orders",
        headers=headers["customer"],
        json={
            "order_type": "dine_in",
            "table_id": table_id,
            "reservation_id": reservation_id,
            "items": [{"product_id": prod_id, "quantity": 2}],
        },
    )
    assert order_res.status_code == 201
    order_data = order_res.json()
    assert order_data["subtotal"] == "30.00"
    assert order_data["tax_amount"] == "3.60"
    assert order_data["total_amount"] == "33.60"

    # Staff avanza estado del pedido
    status_res = client.patch(
        f"/api/v1/orders/{order_data['id']}/status",
        headers=headers["staff"],
        json={"status_code": "confirmed"},
    )
    assert status_res.status_code == 200
    assert status_res.json()["status"]["code"] == "confirmed"

    # Cliente revisa notificaciones automáticas y marca una como leída
    notifs = client.get("/api/v1/notifications", headers=headers["customer"])
    assert notifs.status_code == 200
    assert notifs.json()["total"] >= 3
    first_notif_id = notifs.json()["items"][0]["id"]
    mark = client.patch(f"/api/v1/notifications/{first_notif_id}/read", headers=headers["customer"])
    assert mark.status_code == 200
    assert mark.json()["is_read"] is True

    # Manager consulta reportes
    summary = client.get("/api/v1/reports/summary", headers=headers["manager"])
    assert summary.status_code == 200
    assert summary.json()["total_orders"] == 1
    assert summary.json()["total_revenue"] == "33.60"

    top = client.get("/api/v1/reports/top-products", headers=headers["manager"])
    assert top.status_code == 200
    assert top.json()["items"][0]["product_id"] == prod_id
