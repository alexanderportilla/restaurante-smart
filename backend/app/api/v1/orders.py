from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_current_user, get_order_service
from app.models.auth import User
from app.schemas.common import PaginatedResponse
from app.schemas.orders import (
    OrderCreate,
    OrderResponse,
    OrderStatusResponse,
    OrderStatusUpdate,
)
from app.services.order_service import OrderService

router = APIRouter(tags=["Pedidos"])


@router.get("/order-statuses", response_model=list[OrderStatusResponse])
def list_order_statuses(
    order_service: OrderService = Depends(get_order_service),
) -> list[OrderStatusResponse]:
    return order_service.list_statuses()


@router.get("/orders", response_model=PaginatedResponse[OrderResponse])
def list_orders(
    status_code: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: User = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> PaginatedResponse[OrderResponse]:
    items, total = order_service.list_orders(
        actor=actor,
        status_code=status_code,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    actor: User = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> OrderResponse:
    return order_service.create_order(payload, actor)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: UUID,
    actor: User = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> OrderResponse:
    return order_service.get_order(order_id, actor)


@router.patch("/orders/{order_id}/status", response_model=OrderResponse)
def update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    actor: User = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> OrderResponse:
    return order_service.update_status(order_id, payload.status_code, actor)
