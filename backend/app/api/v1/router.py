from fastapi import APIRouter

from app.api.v1 import (
    auth,
    availability,
    categories,
    health,
    notifications,
    orders,
    products,
    reports,
    reservations,
    roles,
    tables,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(roles.router)
api_router.include_router(categories.router)
api_router.include_router(products.router)
api_router.include_router(tables.router)
api_router.include_router(availability.router)
api_router.include_router(reservations.router)
api_router.include_router(orders.router)
api_router.include_router(notifications.router)
api_router.include_router(reports.router)
