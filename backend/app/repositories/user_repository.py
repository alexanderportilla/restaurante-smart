from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.auth import Role, User
from app.repositories.base import paginate_scalars


class UserRepository:
    """Acceso a datos para usuarios, roles y permisos."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: UUID) -> User | None:
        stmt = (
            select(User)
            .options(selectinload(User.role).selectinload(Role.permissions))
            .where(User.id == user_id)
        )
        return self.db.scalar(stmt)

    def get_by_email(self, email: str) -> User | None:
        stmt = (
            select(User)
            .options(selectinload(User.role).selectinload(Role.permissions))
            .where(User.email == email.lower().strip())
        )
        return self.db.scalar(stmt)

    def list_users(self, *, limit: int = 20, offset: int = 0) -> tuple[list[User], int]:
        stmt = (
            select(User)
            .options(selectinload(User.role).selectinload(Role.permissions))
            .order_by(User.created_at.desc())
        )
        return paginate_scalars(self.db, stmt, limit=limit, offset=offset)

    def get_role_by_code(self, code: str) -> Role | None:
        stmt = select(Role).options(selectinload(Role.permissions)).where(Role.code == code)
        return self.db.scalar(stmt)

    def list_roles(self) -> list[Role]:
        stmt = select(Role).options(selectinload(Role.permissions)).order_by(Role.id.asc())
        return list(self.db.scalars(stmt).all())

    def create(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        self.db.refresh(user)
        return user
