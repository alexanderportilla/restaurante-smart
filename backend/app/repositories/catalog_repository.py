from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.restaurant import Category, Product
from app.repositories.base import paginate_scalars


class CatalogRepository:
    """Acceso a datos para categorías y productos."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_categories(self, *, only_active: bool = False) -> list[Category]:
        stmt = select(Category).order_by(Category.display_order.asc(), Category.name.asc())
        if only_active:
            stmt = stmt.where(Category.is_active.is_(True))
        return list(self.db.scalars(stmt).all())

    def get_category_by_id(self, category_id: int) -> Category | None:
        return self.db.get(Category, category_id)

    def get_category_by_slug_or_name(
        self, slug: str, name: str, *, exclude_category_id: int | None = None
    ) -> Category | None:
        stmt = select(Category).where(or_(Category.slug == slug, Category.name == name))
        if exclude_category_id is not None:
            stmt = stmt.where(Category.id != exclude_category_id)
        return self.db.scalar(stmt)

    def create_category(self, category: Category) -> Category:
        self.db.add(category)
        self.db.flush()
        self.db.refresh(category)
        return category

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
        stmt = select(Product).options(selectinload(Product.category)).order_by(Product.name.asc())
        if only_active:
            stmt = stmt.where(Product.is_active.is_(True))
        if category_id is not None:
            stmt = stmt.where(Product.category_id == category_id)
        if only_available is not None:
            stmt = stmt.where(Product.is_available.is_(only_available))
        if search:
            term = f"%{search.strip()}%"
            stmt = stmt.where(or_(Product.name.ilike(term), Product.description.ilike(term)))
        return paginate_scalars(self.db, stmt, limit=limit, offset=offset)

    def get_product_by_id(self, product_id: int) -> Product | None:
        stmt = (
            select(Product).options(selectinload(Product.category)).where(Product.id == product_id)
        )
        return self.db.scalar(stmt)

    def get_product_by_sku(self, sku: str) -> Product | None:
        return self.db.scalar(select(Product).where(Product.sku == sku))

    def get_products_by_ids(self, product_ids: list[int]) -> list[Product]:
        if not product_ids:
            return []
        stmt = select(Product).where(Product.id.in_(product_ids))
        return list(self.db.scalars(stmt).all())

    def create_product(self, product: Product) -> Product:
        self.db.add(product)
        self.db.flush()
        self.db.refresh(product)
        return product
