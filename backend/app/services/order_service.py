import secrets
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from app.core.config import get_settings
from app.core.exceptions import BusinessRuleError, ForbiddenError, NotFoundError
from app.models.auth import User
from app.models.orders import Order, OrderItem, OrderStatus
from app.models.restaurant import Product
from app.repositories.catalog_repository import CatalogRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.reservation_repository import ReservationRepository
from app.repositories.table_repository import TableRepository
from app.schemas.orders import OrderCreate
from app.services.notification_service import NotificationService

ORDER_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


class OrderService:
    """Servicio transaccional para pedidos en línea, cálculos y máquina de estados."""

    def __init__(
        self,
        order_repo: OrderRepository,
        catalog_repo: CatalogRepository,
        table_repo: TableRepository,
        reservation_repo: ReservationRepository,
        notification_service: NotificationService,
    ) -> None:
        self.order_repo = order_repo
        self.catalog_repo = catalog_repo
        self.table_repo = table_repo
        self.reservation_repo = reservation_repo
        self.notification_service = notification_service

    def list_statuses(self) -> list[OrderStatus]:
        return self.order_repo.list_statuses()

    def create_order(self, payload: OrderCreate, actor: User) -> Order:
        if (
            payload.order_type == "dine_in"
            and payload.table_id is None
            and payload.reservation_id is None
        ):
            raise BusinessRuleError(
                "Un pedido en mesa (dine_in) debe asociarse a una mesa o reserva."
            )

        if payload.table_id is not None:
            table = self.table_repo.get_by_id(payload.table_id)
            if table is None or not table.is_active:
                raise NotFoundError("La mesa asociada no existe o está inactiva.")

        if payload.reservation_id is not None:
            reservation = self.reservation_repo.get_by_id(payload.reservation_id)
            if reservation is None:
                raise NotFoundError("La reserva asociada no existe.")
            if actor.role.code == "customer" and reservation.user_id != actor.id:
                raise ForbiddenError("No puede asociar un pedido a una reserva de otro usuario.")

        pending_status = self.order_repo.get_status_by_code("pending")
        if pending_status is None:
            raise NotFoundError("No existe el estado inicial 'pending' en order_statuses.")

        product_ids = [item.product_id for item in payload.items]
        products: dict[int, Product] = {
            product.id: product for product in self.catalog_repo.get_products_by_ids(product_ids)
        }

        order_items: list[OrderItem] = []
        subtotal = Decimal("0.00")
        for req_item in payload.items:
            product = products.get(req_item.product_id)
            if product is None or not product.is_active:
                raise NotFoundError(f"El producto ID {req_item.product_id} no existe.")
            if not product.is_available:
                raise BusinessRuleError(
                    f"El producto '{product.name}' no está disponible actualmente."
                )

            unit_price = Decimal(product.price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            line_total = (unit_price * req_item.quantity).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            subtotal += line_total
            order_items.append(
                OrderItem(
                    product_id=product.id,
                    quantity=req_item.quantity,
                    unit_price=unit_price,
                    line_total=line_total,
                    special_instructions=req_item.special_instructions,
                )
            )

        settings = get_settings()
        tax_rate = Decimal(str(settings.TAX_RATE))
        tax_amount = (subtotal * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_amount = (subtotal + tax_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        order_number = f"ORD-{datetime.now(UTC).strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
        order = Order(
            order_number=order_number,
            user_id=actor.id,
            table_id=payload.table_id,
            reservation_id=payload.reservation_id,
            status_id=pending_status.id,
            order_type=payload.order_type,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total_amount=total_amount,
            notes=payload.notes,
            items=order_items,
        )

        created = self.order_repo.create(order)
        self.notification_service.add_notification(
            user_id=actor.id,
            event_type="order_created",
            title=f"Pedido {order_number} recibido",
            message=(
                f"Tu pedido por {total_amount} ha sido registrado y está pendiente de confirmación."
            ),
            reference_type="order",
            reference_id=created.id,
        )
        self.order_repo.db.commit()
        return self.order_repo.get_by_id(created.id) or created

    def list_orders(
        self,
        *,
        actor: User,
        status_code: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Order], int]:
        scoped_user_id = actor.id if actor.role.code == "customer" else None
        return self.order_repo.list_orders(
            user_id=scoped_user_id,
            status_code=status_code,
            limit=limit,
            offset=offset,
        )

    def get_order(self, order_id: UUID, actor: User) -> Order:
        order = self.order_repo.get_by_id(order_id)
        if order is None:
            raise NotFoundError("Pedido no encontrado.")
        if actor.role.code == "customer" and order.user_id != actor.id:
            raise ForbiddenError("No tiene permisos para ver este pedido.")
        return order

    def update_status(self, order_id: UUID, status_code: str, actor: User) -> Order:
        order = self.get_order(order_id, actor)
        if actor.role.code == "customer" and (
            status_code != "cancelled" or order.status.code != "pending"
        ):
            raise ForbiddenError(
                "Solo puede cancelar su pedido mientras está en estado pendiente."
            )

        allowed = ORDER_TRANSITIONS.get(order.status.code, set())
        if status_code not in allowed:
            raise BusinessRuleError(
                f"Transición de estado inválida: '{order.status.code}' -> '{status_code}'."
            )

        target_status = self.order_repo.get_status_by_code(status_code)
        if target_status is None:
            raise NotFoundError(f"El estado '{status_code}' no existe.")

        order.status_id = target_status.id
        order.status = target_status
        if status_code == "confirmed" and order.confirmed_at is None:
            order.confirmed_at = datetime.now(UTC)

        self.notification_service.add_notification(
            user_id=order.user_id,
            event_type=f"order_{status_code}",
            title=f"Pedido {order.order_number}: {target_status.name}",
            message=(
                f"Tu pedido {order.order_number} ahora se encuentra en estado "
                f"'{target_status.name}'."
            ),
            reference_type="order",
            reference_id=order.id,
        )
        self.order_repo.db.commit()
        return self.order_repo.get_by_id(order.id) or order
