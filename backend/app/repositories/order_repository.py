from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.orders import Order, OrderItem, OrderStatus
from app.models.restaurant import Product, Reservation, RestaurantTable
from app.repositories.base import paginate_scalars


class OrderRepository:
    """Acceso a datos para pedidos, estados de pedido y reportes."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_statuses(self) -> list[OrderStatus]:
        stmt = select(OrderStatus).order_by(OrderStatus.sort_order.asc())
        return list(self.db.scalars(stmt).all())

    def get_status_by_code(self, code: str) -> OrderStatus | None:
        return self.db.scalar(select(OrderStatus).where(OrderStatus.code == code))

    def get_by_id(self, order_id: UUID) -> Order | None:
        stmt = (
            select(Order)
            .options(
                selectinload(Order.status),
                selectinload(Order.items).selectinload(OrderItem.product),
            )
            .where(Order.id == order_id)
        )
        return self.db.scalar(stmt)

    def list_orders(
        self,
        *,
        user_id: UUID | None = None,
        status_code: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Order], int]:
        stmt = (
            select(Order)
            .options(
                selectinload(Order.status),
                selectinload(Order.items).selectinload(OrderItem.product),
            )
            .order_by(Order.created_at.desc())
        )
        if user_id is not None:
            stmt = stmt.where(Order.user_id == user_id)
        if status_code is not None:
            stmt = stmt.join(Order.status).where(OrderStatus.code == status_code)
        return paginate_scalars(self.db, stmt, limit=limit, offset=offset)

    def create(self, order: Order) -> Order:
        self.db.add(order)
        self.db.flush()
        self.db.refresh(order)
        return order

    def get_summary_metrics(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> dict:
        """Calcula métricas operativas agregadas en PostgreSQL."""
        order_filters = []
        reservation_filters = []
        if from_date is not None:
            order_filters.append(Order.created_at >= from_date)
            reservation_filters.append(Reservation.start_time >= from_date)
        if to_date is not None:
            order_filters.append(Order.created_at <= to_date)
            reservation_filters.append(Reservation.start_time <= to_date)

        cancelled_status = self.get_status_by_code("cancelled")
        revenue_filters = list(order_filters)
        if cancelled_status is not None:
            revenue_filters.append(Order.status_id != cancelled_status.id)

        total_orders_stmt = (
            select(func.count(Order.id)).where(and_(*order_filters))
            if order_filters
            else select(func.count(Order.id))
        )
        total_orders: int = self.db.execute(total_orders_stmt).scalar_one()

        revenue_stmt = select(func.coalesce(func.sum(Order.total_amount), Decimal("0.00")))
        if revenue_filters:
            revenue_stmt = revenue_stmt.where(and_(*revenue_filters))
        total_revenue: Decimal = self.db.execute(revenue_stmt).scalar_one()

        res_stmt = select(func.count(Reservation.id))
        if reservation_filters:
            res_stmt = res_stmt.where(and_(*reservation_filters))
        total_reservations: int = self.db.execute(res_stmt).scalar_one()

        active_tables: int = self.db.execute(
            select(func.count(RestaurantTable.id)).where(RestaurantTable.is_active.is_(True))
        ).scalar_one()

        status_stmt = (
            select(OrderStatus.code, OrderStatus.name, func.count(Order.id))
            .outerjoin(
                Order,
                and_(Order.status_id == OrderStatus.id, *order_filters)
                if order_filters
                else Order.status_id == OrderStatus.id,
            )
            .group_by(OrderStatus.id, OrderStatus.code, OrderStatus.name, OrderStatus.sort_order)
            .order_by(OrderStatus.sort_order.asc())
        )
        status_rows = self.db.execute(status_stmt).all()

        return {
            "total_orders": total_orders,
            "total_revenue": Decimal(total_revenue),
            "total_reservations": total_reservations,
            "active_tables": active_tables,
            "orders_by_status": [
                {"status_code": code, "status_name": name, "count": count}
                for code, name, count in status_rows
            ],
        }

    def get_top_products(
        self,
        *,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Retorna los productos más vendidos excluyendo pedidos cancelados."""
        filters = [OrderStatus.code != "cancelled"]
        if from_date is not None:
            filters.append(Order.created_at >= from_date)
        if to_date is not None:
            filters.append(Order.created_at <= to_date)

        stmt = (
            select(
                Product.id,
                Product.name,
                Product.sku,
                func.sum(OrderItem.quantity).label("total_quantity"),
                func.sum(OrderItem.line_total).label("total_revenue"),
            )
            .join(OrderItem, OrderItem.product_id == Product.id)
            .join(Order, Order.id == OrderItem.order_id)
            .join(OrderStatus, OrderStatus.id == Order.status_id)
            .where(and_(*filters))
            .group_by(Product.id, Product.name, Product.sku)
            .order_by(func.sum(OrderItem.quantity).desc())
            .limit(limit)
        )
        rows = self.db.execute(stmt).all()
        return [
            {
                "product_id": pid,
                "product_name": pname,
                "sku": sku,
                "total_quantity": int(qty),
                "total_revenue": Decimal(rev),
            }
            for pid, pname, sku, qty, rev in rows
        ]
