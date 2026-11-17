from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin, utc_now

if TYPE_CHECKING:
    from app.models.auth import User
    from app.models.restaurant import Product, Reservation, RestaurantTable


class OrderStatus(Base):
    """Catálogo normalizado de estados de un pedido."""

    __tablename__ = "order_statuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    orders: Mapped[list["Order"]] = relationship(back_populates="status")


class Order(TimestampMixin, Base):
    """Pedido en línea o en mesa del restaurante."""

    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "order_type IN ('dine_in', 'takeaway', 'delivery')",
            name="valid_order_type",
        ),
        CheckConstraint("subtotal >= 0", name="subtotal_non_negative"),
        CheckConstraint("tax_amount >= 0", name="tax_non_negative"),
        CheckConstraint("total_amount >= 0", name="total_non_negative"),
        Index("ix_orders_user_created", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    order_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    table_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("tables.id", ondelete="SET NULL"),
        nullable=True,
    )
    reservation_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("reservations.id", ondelete="SET NULL"),
        nullable=True,
    )
    status_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("order_statuses.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    order_type: Mapped[str] = mapped_column(String(20), default="takeaway", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User | None"] = relationship(back_populates="orders")
    table: Mapped["RestaurantTable | None"] = relationship(back_populates="orders", lazy="selectin")
    reservation: Mapped["Reservation | None"] = relationship(back_populates="orders")
    status: Mapped[OrderStatus] = relationship(back_populates="orders", lazy="selectin")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class OrderItem(Base):
    """Línea de detalle de un pedido con precio congelado al momento de compra."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
        CheckConstraint("line_total >= 0", name="line_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    special_instructions: Mapped[str | None] = mapped_column(String(255), nullable=True)

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship(back_populates="order_items", lazy="selectin")

    @property
    def product_name(self) -> str | None:
        return self.product.name if self.product is not None else None


class Notification(Base):
    """Notificación automática generada para confirmaciones y cambios de estado."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("channel IN ('in_app', 'email_simulated')", name="valid_channel"),
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="valid_notif_status"),
        Index("ix_notifications_user_read_created", "user_id", "is_read", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    channel: Mapped[str] = mapped_column(String(30), default="in_app", nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    reference_type: Mapped[str] = mapped_column(String(40), nullable=False)
    reference_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="sent", nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utc_now)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    user: Mapped["User | None"] = relationship(back_populates="notifications")
