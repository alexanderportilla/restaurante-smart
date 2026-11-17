#!/usr/bin/env python3
"""Utilidad de seed/limpieza aislada para E2E sobre restaurante_smart_test (sin tocar restaurante_smart)."""

import json
import os
import pathlib
import sys
from uuid import UUID

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
SECRET_PATH = pathlib.Path("/home/alexpc/.local/share/restaurante-smart-test/postgres_test_password")

sys.path.insert(0, str(BACKEND_DIR))

from app.core.security import hash_password  # noqa: E402
from app.models.auth import Role, User  # noqa: E402
from app.models.orders import Notification, Order, OrderItem  # noqa: E402
from app.models.restaurant import Category, Product, Reservation, RestaurantTable  # noqa: E402
from tests.conftest import require_isolated_test_database_url  # noqa: E402


def get_validated_url() -> str:
    if not SECRET_PATH.is_file():
        raise SystemExit(
            "ERROR: No existe el archivo de contraseña temporal para restaurante_smart_test."
        )
    password = SECRET_PATH.read_text(encoding="utf-8").strip()
    raw_url = (
        f"postgresql+psycopg://restaurante_test_user:{password}"
        "@127.0.0.1:5433/restaurante_smart_test"
    )
    return require_isolated_test_database_url("1", raw_url)


def get_session():
    os.environ["APP_ENV"] = "test"
    os.environ["JWT_SECRET_KEY"] = "e2e-test-only-jwt-secret-key-with-minimum-32-chars-restaurante"
    url = get_validated_url()
    engine = create_engine(url, pool_pre_ping=True)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def cmd_verify() -> None:
    engine, _ = get_session()
    tables = [
        "users",
        "tables",
        "categories",
        "products",
        "reservations",
        "orders",
        "order_items",
        "notifications",
    ]
    with engine.connect() as conn:
        db_name, db_user = conn.execute(
            text("SELECT current_database(), current_user")
        ).one()
        alembic_ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        counts = {t: conn.execute(text(f"SELECT count(*) FROM {t}")).scalar_one() for t in tables}
    print(
        json.dumps(
            {
                "database": db_name,
                "user": db_user,
                "alembic_version": alembic_ver,
                "counts": counts,
            }
        )
    )


def cmd_seed(run_id: str, password: str) -> None:
    _, SessionLocal = get_session()
    roles_to_seed = [
        ("admin", f"E2E_{run_id} Admin", f"e2e_admin_{run_id}@example.com", "0990000001"),
        ("manager", f"E2E_{run_id} Manager", f"e2e_manager_{run_id}@example.com", "0990000002"),
        ("staff", f"E2E_{run_id} Staff", f"e2e_staff_{run_id}@example.com", "0990000003"),
        ("customer", f"E2E_{run_id} Customer", f"e2e_customer_{run_id}@example.com", "0990000004"),
    ]
    seeded: dict[str, dict[str, str]] = {}
    with SessionLocal() as db:
        role_map = {
            r.code: r.id for r in db.execute(select(Role)).scalars().all()
        }
        pw_hash = hash_password(password)
        for role_code, full_name, email, phone in roles_to_seed:
            existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if existing is None:
                user = User(
                    full_name=full_name,
                    email=email,
                    phone=phone,
                    password_hash=pw_hash,
                    role_id=role_map[role_code],
                    is_active=True,
                )
                db.add(user)
                db.flush()
            else:
                user = existing
            seeded[role_code] = {
                "id": str(user.id),
                "email": email,
                "full_name": full_name,
                "role_code": role_code,
            }
        db.commit()
    print(json.dumps(seeded))


def cmd_cleanup(run_id: str) -> None:
    _, SessionLocal = get_session()
    prefix = f"E2E_{run_id}"
    email_suffix = f"_{run_id}@example.com"

    with SessionLocal() as db:
        user_ids: list[UUID] = list(
            db.execute(
                select(User.id).where(
                    User.email.like(f"%{email_suffix}") | User.full_name.like(f"{prefix}%")
                )
            )
            .scalars()
            .all()
        )
        table_ids = list(
            db.execute(
                select(RestaurantTable.id).where(
                    RestaurantTable.code.like(f"E2E-{run_id}%")
                    | RestaurantTable.name.like(f"{prefix}%")
                )
            )
            .scalars()
            .all()
        )
        category_ids = list(
            db.execute(
                select(Category.id).where(
                    Category.name.like(f"{prefix}%") | Category.slug.like(f"e2e-{run_id}%")
                )
            )
            .scalars()
            .all()
        )
        product_ids = list(
            db.execute(
                select(Product.id).where(
                    Product.name.like(f"{prefix}%")
                    | Product.sku.like(f"E2E-{run_id}%")
                    | (Product.category_id.in_(category_ids) if category_ids else False)
                )
            )
            .scalars()
            .all()
        )
        reservation_ids = list(
            db.execute(
                select(Reservation.id).where(
                    Reservation.customer_name.like(f"{prefix}%")
                    | Reservation.customer_email.like(f"%{email_suffix}")
                    | (Reservation.user_id.in_(user_ids) if user_ids else False)
                    | (Reservation.table_id.in_(table_ids) if table_ids else False)
                )
            )
            .scalars()
            .all()
        )
        order_ids = list(
            db.execute(
                select(Order.id).where(
                    Order.notes.like(f"%{prefix}%")
                    | (Order.user_id.in_(user_ids) if user_ids else False)
                    | (Order.reservation_id.in_(reservation_ids) if reservation_ids else False)
                )
            )
            .scalars()
            .all()
        )

        deleted = {}
        if order_ids:
            deleted["order_items"] = (
                db.query(OrderItem)
                .filter(OrderItem.order_id.in_(order_ids))
                .delete(synchronize_session=False)
            )
            deleted["orders"] = (
                db.query(Order)
                .filter(Order.id.in_(order_ids))
                .delete(synchronize_session=False)
            )
        if reservation_ids:
            deleted["reservations"] = (
                db.query(Reservation)
                .filter(Reservation.id.in_(reservation_ids))
                .delete(synchronize_session=False)
            )
        if user_ids:
            deleted["notifications"] = (
                db.query(Notification)
                .filter(Notification.user_id.in_(user_ids))
                .delete(synchronize_session=False)
            )
            deleted["users"] = (
                db.query(User)
                .filter(User.id.in_(user_ids))
                .delete(synchronize_session=False)
            )
        if product_ids:
            deleted["products"] = (
                db.query(Product)
                .filter(Product.id.in_(product_ids))
                .delete(synchronize_session=False)
            )
        if category_ids:
            deleted["categories"] = (
                db.query(Category)
                .filter(Category.id.in_(category_ids))
                .delete(synchronize_session=False)
            )
        if table_ids:
            deleted["tables"] = (
                db.query(RestaurantTable)
                .filter(RestaurantTable.id.in_(table_ids))
                .delete(synchronize_session=False)
            )
        db.commit()
    print(json.dumps({"run_id": run_id, "deleted": deleted}))


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "verify":
        cmd_verify()
    elif action == "seed":
        cmd_seed(sys.argv[2], sys.argv[3])
    elif action == "cleanup":
        cmd_cleanup(sys.argv[2])
    else:
        raise SystemExit(f"Acción no soportada: {action}")
