import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.exceptions import ConflictError
from app.core.security import hash_password
from app.db.session import get_engine, get_session_factory
from app.main import create_app
from app.models.auth import User
from app.models.orders import Notification, Order, OrderItem
from app.models.restaurant import Category, Product, Reservation, RestaurantTable
from app.repositories.catalog_repository import CatalogRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.reservation_repository import ReservationRepository
from app.repositories.table_repository import TableRepository
from app.repositories.user_repository import UserRepository
from app.schemas.orders import OrderCreate, OrderItemCreate
from app.schemas.reservations import ReservationCreate
from app.services.notification_service import NotificationService
from app.services.order_service import OrderService
from app.services.report_service import ReportService
from app.services.reservation_service import ReservationService

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_TESTS") != "1",
    reason="Pruebas reales contra PostgreSQL desactivadas (establecer RUN_POSTGRES_TESTS=1).",
)


def test_postgres_schema_btree_gist_and_seed_catalogs() -> None:
    get_settings.cache_clear()
    get_engine.cache_clear()
    session_factory = get_session_factory()

    with session_factory() as db:
        version = db.execute(text("SELECT version();")).scalar_one()
        assert "PostgreSQL 17" in version

        ext = db.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'btree_gist';")
        ).scalar_one_or_none()
        assert ext == "btree_gist"

        constraint = db.execute(
            text(
                "SELECT contype FROM pg_constraint "
                "WHERE conname = 'uq_reservations_no_overlap';"
            )
        ).scalar_one_or_none()
        assert constraint == "x"

        alembic_ver = db.execute(text("SELECT version_num FROM alembic_version;")).scalar_one()
        assert alembic_ver == "0002_align_unique_indexes"

        role_codes = set(db.execute(text("SELECT code FROM roles;")).scalars().all())
        assert role_codes == {"admin", "manager", "staff", "customer"}

        status_codes = set(db.execute(text("SELECT code FROM order_statuses;")).scalars().all())
        assert status_codes == {
            "pending",
            "confirmed",
            "preparing",
            "ready",
            "delivered",
            "cancelled",
        }


def test_postgres_crud_exclusion_constraint_transactions_and_e2e_api() -> None:
    get_settings.cache_clear()
    get_engine.cache_clear()
    session_factory = get_session_factory()
    suffix = uuid4().hex[:8]

    created_user_ids = []
    created_table_ids = []
    created_category_ids = []
    created_product_ids = []
    created_reservation_ids = []
    created_order_ids = []

    try:
        with session_factory() as db:
            user_repo = UserRepository(db)
            cat_repo = CatalogRepository(db)
            table_repo = TableRepository(db)
            res_repo = ReservationRepository(db)
            order_repo = OrderRepository(db)
            notif_service = NotificationService(NotificationRepository(db))
            res_service = ReservationService(res_repo, table_repo, notif_service)
            order_service = OrderService(
                order_repo=order_repo,
                catalog_repo=cat_repo,
                table_repo=table_repo,
                reservation_repo=res_repo,
                notification_service=notif_service,
            )

            admin_role = user_repo.get_role_by_code("admin")
            customer_role = user_repo.get_role_by_code("customer")
            assert admin_role is not None and customer_role is not None

            admin_user = user_repo.create(
                User(
                    role_id=admin_role.id,
                    full_name=f"Admin PG {suffix}",
                    email=f"admin_{suffix}@example.com",
                    phone="0990000001",
                    password_hash=hash_password("PgTestPass123!"),
                    is_active=True,
                )
            )
            customer_user = user_repo.create(
                User(
                    role_id=customer_role.id,
                    full_name=f"Cliente PG {suffix}",
                    email=f"cliente_{suffix}@example.com",
                    phone="0990000002",
                    password_hash=hash_password("PgTestPass123!"),
                    is_active=True,
                )
            )
            created_user_ids.extend([admin_user.id, customer_user.id])

            table = table_repo.create(
                RestaurantTable(
                    code=f"PG-{suffix[:6]}",
                    name=f"Mesa PG {suffix}",
                    capacity=4,
                    location="Salón PostgreSQL",
                    is_active=True,
                )
            )
            created_table_ids.append(table.id)

            category = cat_repo.create_category(
                Category(
                    name=f"Cat PG {suffix}",
                    slug=f"cat-pg-{suffix}",
                    display_order=1,
                    is_active=True,
                )
            )
            created_category_ids.append(category.id)

            product = cat_repo.create_product(
                Product(
                    category_id=category.id,
                    name=f"Plato PG {suffix}",
                    sku=f"SKU-PG-{suffix}",
                    description="Prueba real PostgreSQL",
                    price=Decimal("14.75"),
                    preparation_minutes=15,
                    is_available=True,
                    is_active=True,
                )
            )
            created_product_ids.append(product.id)
            db.commit()

            # Validar precisión decimal y fechas UTC
            persisted_prod = cat_repo.get_product_by_id(product.id)
            assert persisted_prod is not None
            assert persisted_prod.price == Decimal("14.75")

            start_utc = datetime(2026, 12, 20, 19, 0, tzinfo=UTC)
            end_utc = start_utc + timedelta(hours=2)

            res1 = res_service.create_reservation(
                ReservationCreate(
                    table_id=table.id,
                    customer_name=customer_user.full_name,
                    customer_email=customer_user.email,
                    customer_phone="0990000002",
                    party_size=4,
                    start_time=start_utc,
                    end_time=end_utc,
                ),
                customer_user,
            )
            created_reservation_ids.append(res1.id)
            assert res1.start_time.tzinfo is not None
            assert res1.start_time.utcoffset() == timedelta(0)

            # Solapamiento detectado por servicio
            with pytest.raises(ConflictError):
                res_service.create_reservation(
                    ReservationCreate(
                        table_id=table.id,
                        customer_name="Otro",
                        customer_email=f"otro_{suffix}@example.com",
                        customer_phone="0990000003",
                        party_size=2,
                        start_time=start_utc + timedelta(minutes=30),
                        end_time=end_utc + timedelta(minutes=30),
                    ),
                    admin_user,
                )

            # Inserción directa para verificar rechazo nativo de PostgreSQL EXCLUDE USING gist
            direct_conflict = Reservation(
                user_id=admin_user.id,
                table_id=table.id,
                customer_name="Directo DB",
                customer_email=f"direct_{suffix}@example.com",
                customer_phone="0990000004",
                party_size=2,
                start_time=start_utc + timedelta(minutes=15),
                end_time=end_utc,
                status="confirmed",
                confirmation_code=f"DIR-{suffix[:6]}",
            )
            db.add(direct_conflict)
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()

            # Cancelar libera la mesa en el índice parcial GiST
            res_service.update_status(res1.id, "cancelled", customer_user)
            res2 = res_service.create_reservation(
                ReservationCreate(
                    table_id=table.id,
                    customer_name="Nuevo Turno",
                    customer_email=f"turno_{suffix}@example.com",
                    customer_phone="0990000005",
                    party_size=2,
                    start_time=start_utc,
                    end_time=end_utc,
                ),
                customer_user,
            )
            created_reservation_ids.append(res2.id)
            assert res2.status == "confirmed"

            # Pedido con cálculo decimal en servidor + reportes agregados PostgreSQL
            order = order_service.create_order(
                OrderCreate(
                    order_type="dine_in",
                    table_id=table.id,
                    reservation_id=res2.id,
                    items=[OrderItemCreate(product_id=product.id, quantity=2)],
                ),
                customer_user,
            )
            created_order_ids.append(order.id)
            assert order.subtotal == Decimal("29.50")
            assert order.tax_amount == Decimal("3.54")
            assert order.total_amount == Decimal("33.04")

            confirmed_order = order_service.update_status(order.id, "confirmed", admin_user)
            assert confirmed_order.status.code == "confirmed"
            assert confirmed_order.confirmed_at is not None

            report_service = ReportService(order_repo)
            summary = report_service.get_summary()
            assert summary.total_orders >= 1
            assert summary.total_revenue >= Decimal("33.04")
            top = report_service.get_top_products(limit=5)
            assert any(item.product_id == product.id for item in top.items)

        # Prueba HTTP real de FastAPI sin dependency_overrides contra PostgreSQL
        app = create_app()
        with TestClient(app) as client:
            health = client.get("/api/v1/health")
            assert health.status_code == 200
            assert health.json()["database"] == "connected"

            login = client.post(
                "/api/v1/auth/login",
                json={"email": f"cliente_{suffix}@example.com", "password": "PgTestPass123!"},
            )
            assert login.status_code == 200
            token = login.json()["access_token"]

            avail = client.get(
                "/api/v1/availability",
                params={
                    "start_time": (start_utc + timedelta(days=1)).isoformat(),
                    "end_time": (end_utc + timedelta(days=1)).isoformat(),
                    "party_size": 2,
                },
            )
            assert avail.status_code == 200
            assert any(t["id"] == created_table_ids[0] for t in avail.json()["available_tables"])

            notifs = client.get(
                "/api/v1/notifications",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert notifs.status_code == 200
            assert notifs.json()["total"] >= 5
    finally:
        # Limpieza exclusiva de registros sintéticos de esta prueba (sin tocar esquema ni catálogos)
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
