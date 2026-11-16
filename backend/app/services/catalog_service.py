from app.core.exceptions import ConflictError, NotFoundError
from app.models.restaurant import Category, Product
from app.repositories.base import apply_updates
from app.repositories.catalog_repository import CatalogRepository
from app.schemas.catalog import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate


class CatalogService:
    """Servicio para gestión del catálogo de categorías y productos."""

    def __init__(self, catalog_repo: CatalogRepository) -> None:
        self.catalog_repo = catalog_repo

    def list_categories(self, *, only_active: bool = False) -> list[Category]:
        return self.catalog_repo.list_categories(only_active=only_active)

    def create_category(self, payload: CategoryCreate) -> Category:
        if self.catalog_repo.get_category_by_slug_or_name(payload.slug, payload.name) is not None:
            raise ConflictError("Ya existe una categoría con ese nombre o slug.")
        category = Category(**payload.model_dump())
        created = self.catalog_repo.create_category(category)
        self.catalog_repo.db.commit()
        return created

    def update_category(self, category_id: int, payload: CategoryUpdate) -> Category:
        category = self.catalog_repo.get_category_by_id(category_id)
        if category is None:
            raise NotFoundError("Categoría no encontrada.")
        updates = payload.model_dump(exclude_unset=True)
        apply_updates(category, updates)
        self.catalog_repo.db.commit()
        self.catalog_repo.db.refresh(category)
        return category

    def delete_category(self, category_id: int) -> None:
        category = self.catalog_repo.get_category_by_id(category_id)
        if category is None:
            raise NotFoundError("Categoría no encontrada.")
        category.is_active = False
        self.catalog_repo.db.commit()

    def list_products(
        self,
        *,
        category_id: int | None = None,
        only_available: bool | None = None,
        only_active: bool = True,
        search: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Product], int]:
        return self.catalog_repo.list_products(
            category_id=category_id,
            only_available=only_available,
            only_active=only_active,
            search=search,
            limit=limit,
            offset=offset,
        )

    def get_product(self, product_id: int) -> Product:
        product = self.catalog_repo.get_product_by_id(product_id)
        if product is None or not product.is_active:
            raise NotFoundError("Producto no encontrado.")
        return product

    def create_product(self, payload: ProductCreate) -> Product:
        if self.catalog_repo.get_category_by_id(payload.category_id) is None:
            raise NotFoundError("La categoría especificada no existe.")
        if self.catalog_repo.get_product_by_sku(payload.sku) is not None:
            raise ConflictError("Ya existe un producto con ese SKU.")
        product = Product(**payload.model_dump())
        created = self.catalog_repo.create_product(product)
        self.catalog_repo.db.commit()
        return self.catalog_repo.get_product_by_id(created.id) or created

    def update_product(self, product_id: int, payload: ProductUpdate) -> Product:
        product = self.catalog_repo.get_product_by_id(product_id)
        if product is None:
            raise NotFoundError("Producto no encontrado.")
        updates = payload.model_dump(exclude_unset=True)
        if (
            "category_id" in updates
            and self.catalog_repo.get_category_by_id(updates["category_id"]) is None
        ):
            raise NotFoundError("La categoría especificada no existe.")
        apply_updates(product, updates)
        self.catalog_repo.db.commit()
        return self.catalog_repo.get_product_by_id(product.id) or product

    def delete_product(self, product_id: int) -> None:
        product = self.catalog_repo.get_product_by_id(product_id)
        if product is None:
            raise NotFoundError("Producto no encontrado.")
        product.is_active = False
        product.is_available = False
        self.catalog_repo.db.commit()
