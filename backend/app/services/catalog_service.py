from app.core.exceptions import ConflictError, NotFoundError
from app.models.restaurant import Category, Product
from app.repositories.base import apply_updates, commit_or_conflict
from app.repositories.catalog_repository import CatalogRepository
from app.schemas.catalog import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate


class CatalogService:
    """Servicio para gestión del catálogo de categorías y productos."""

    def __init__(self, catalog_repo: CatalogRepository) -> None:
        self.catalog_repo = catalog_repo

    def list_categories(self, *, only_active: bool = False) -> list[Category]:
        return self.catalog_repo.list_categories(only_active=only_active)

    def create_category(self, payload: CategoryCreate) -> Category:
        data = payload.model_dump()
        data["name"] = data["name"].strip()
        data["slug"] = data["slug"].strip()
        if data.get("description") is not None:
            data["description"] = data["description"].strip() or None
        if self.catalog_repo.get_category_by_slug_or_name(data["slug"], data["name"]) is not None:
            raise ConflictError("Ya existe una categoría con ese nombre o slug.")
        category = Category(**data)
        created = self.catalog_repo.create_category(category)
        commit_or_conflict(
            self.catalog_repo.db,
            "Ya existe una categoría con ese nombre o slug.",
        )
        return created

    def update_category(self, category_id: int, payload: CategoryUpdate) -> Category:
        category = self.catalog_repo.get_category_by_id(category_id)
        if category is None:
            raise NotFoundError("Categoría no encontrada.")
        updates = payload.model_dump(exclude_unset=True)
        if updates.get("name") is not None:
            updates["name"] = updates["name"].strip()
        if updates.get("slug") is not None:
            updates["slug"] = updates["slug"].strip()
        if "description" in updates and updates["description"] is not None:
            updates["description"] = updates["description"].strip() or None
        if "slug" in updates or "name" in updates:
            target_slug = updates.get("slug", category.slug)
            target_name = updates.get("name", category.name)
            if (
                self.catalog_repo.get_category_by_slug_or_name(
                    target_slug, target_name, exclude_category_id=category_id
                )
                is not None
            ):
                raise ConflictError("Ya existe una categoría con ese nombre o slug.")
        apply_updates(category, updates)
        commit_or_conflict(
            self.catalog_repo.db,
            "Ya existe una categoría con ese nombre o slug.",
        )
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
        data = payload.model_dump()
        data["name"] = data["name"].strip()
        data["sku"] = data["sku"].strip()
        if data.get("description") is not None:
            data["description"] = data["description"].strip() or None
        if self.catalog_repo.get_product_by_sku(data["sku"]) is not None:
            raise ConflictError("Ya existe un producto con ese SKU.")
        product = Product(**data)
        created = self.catalog_repo.create_product(product)
        commit_or_conflict(self.catalog_repo.db, "Ya existe un producto con ese SKU.")
        return self.catalog_repo.get_product_by_id(created.id) or created

    def update_product(self, product_id: int, payload: ProductUpdate) -> Product:
        product = self.catalog_repo.get_product_by_id(product_id)
        if product is None:
            raise NotFoundError("Producto no encontrado.")
        updates = payload.model_dump(exclude_unset=True)
        if updates.get("name") is not None:
            updates["name"] = updates["name"].strip()
        if updates.get("sku") is not None:
            updates["sku"] = updates["sku"].strip()
            existing = self.catalog_repo.get_product_by_sku(updates["sku"])
            if existing is not None and existing.id != product_id:
                raise ConflictError("Ya existe un producto con ese SKU.")
        if "description" in updates and updates["description"] is not None:
            updates["description"] = updates["description"].strip() or None
        if (
            "category_id" in updates
            and self.catalog_repo.get_category_by_id(updates["category_id"]) is None
        ):
            raise NotFoundError("La categoría especificada no existe.")
        apply_updates(product, updates)
        commit_or_conflict(self.catalog_repo.db, "Ya existe un producto con ese SKU.")
        return self.catalog_repo.get_product_by_id(product.id) or product

    def delete_product(self, product_id: int) -> None:
        product = self.catalog_repo.get_product_by_id(product_id)
        if product is None:
            raise NotFoundError("Producto no encontrado.")
        product.is_active = False
        product.is_available = False
        self.catalog_repo.db.commit()
