from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_catalog_service, get_optional_current_user, require_roles
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.models.auth import User
from app.schemas.catalog import ProductCreate, ProductResponse, ProductUpdate
from app.schemas.common import PaginatedResponse
from app.services.catalog_service import CatalogService

router = APIRouter(prefix="/products", tags=["Productos"])


@router.get("", response_model=PaginatedResponse[ProductResponse])
def list_products(
    category_id: int | None = Query(default=None, gt=0),
    only_available: bool | None = Query(default=None),
    only_active: bool = Query(default=True),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: User | None = Depends(get_optional_current_user),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> PaginatedResponse[ProductResponse]:
    if not only_active:
        if actor is None:
            raise UnauthorizedError("Autenticación requerida para consultar productos inactivos.")
        if actor.role.code not in {"admin", "manager"}:
            raise ForbiddenError("No posee permisos para consultar productos inactivos.")
    items, total = catalog_service.list_products(
        category_id=category_id,
        only_available=only_available,
        only_active=only_active,
        search=search,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> ProductResponse:
    return catalog_service.get_product(product_id)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> ProductResponse:
    return catalog_service.create_product(payload)


@router.patch("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> ProductResponse:
    return catalog_service.update_product(product_id, payload)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> None:
    catalog_service.delete_product(product_id)
