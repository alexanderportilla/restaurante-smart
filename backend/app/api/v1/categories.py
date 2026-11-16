from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_catalog_service, require_roles
from app.models.auth import User
from app.schemas.catalog import CategoryCreate, CategoryResponse, CategoryUpdate
from app.services.catalog_service import CatalogService

router = APIRouter(prefix="/categories", tags=["Categorías"])


@router.get("", response_model=list[CategoryResponse])
def list_categories(
    only_active: bool = Query(default=False),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> list[CategoryResponse]:
    return catalog_service.list_categories(only_active=only_active)


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> CategoryResponse:
    return catalog_service.create_category(payload)


@router.patch("/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> CategoryResponse:
    return catalog_service.update_category(category_id, payload)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    _actor: User = Depends(require_roles("admin", "manager")),
    catalog_service: CatalogService = Depends(get_catalog_service),
) -> None:
    catalog_service.delete_category(category_id)
