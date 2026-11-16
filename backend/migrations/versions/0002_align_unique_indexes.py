"""Alinea restricciones únicas redundantes con índices únicos SQLAlchemy 2.

Revision ID: 0002_align_unique_indexes
Revises: 0001_initial_schema
Create Date: 2026-11-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_align_unique_indexes"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REDUNDANT_CONSTRAINTS: list[tuple[str, str]] = [
    ("uq_categories_slug", "categories"),
    ("uq_order_statuses_code", "order_statuses"),
    ("uq_orders_order_number", "orders"),
    ("uq_permissions_code", "permissions"),
    ("uq_products_sku", "products"),
    ("uq_reservations_confirmation_code", "reservations"),
    ("uq_roles_code", "roles"),
    ("uq_tables_code", "tables"),
    ("uq_users_email", "users"),
]


def upgrade() -> None:
    for constraint_name, table_name in REDUNDANT_CONSTRAINTS:
        op.drop_constraint(constraint_name, table_name, type_="unique")


def downgrade() -> None:
    column_map = {
        "uq_categories_slug": "slug",
        "uq_order_statuses_code": "code",
        "uq_orders_order_number": "order_number",
        "uq_permissions_code": "code",
        "uq_products_sku": "sku",
        "uq_reservations_confirmation_code": "confirmation_code",
        "uq_roles_code": "code",
        "uq_tables_code": "code",
        "uq_users_email": "email",
    }
    for constraint_name, table_name in REDUNDANT_CONSTRAINTS:
        op.create_unique_constraint(constraint_name, table_name, [column_map[constraint_name]])
