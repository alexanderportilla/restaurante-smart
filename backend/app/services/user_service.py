from uuid import UUID

from app.core.exceptions import BusinessRuleError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import hash_password
from app.models.auth import Role, User
from app.repositories.base import commit_or_conflict
from app.repositories.user_repository import UserRepository
from app.schemas.users import UserCreate, UserUpdate


class UserService:
    """Servicio de gestión de usuarios y roles."""

    def __init__(self, user_repo: UserRepository) -> None:
        self.user_repo = user_repo

    def list_users(self, *, limit: int = 20, offset: int = 0) -> tuple[list[User], int]:
        return self.user_repo.list_users(limit=limit, offset=offset)

    def get_user(self, user_id: UUID, actor: User) -> User:
        if actor.role.code not in {"admin", "manager"} and actor.id != user_id:
            raise ForbiddenError("No tiene permisos para consultar este usuario.")
        user = self.user_repo.get_by_id(user_id)
        if user is None:
            raise NotFoundError("Usuario no encontrado.")
        return user

    def create_user(self, payload: UserCreate) -> User:
        normalized_email = payload.email.lower().strip()
        if self.user_repo.get_by_email(normalized_email) is not None:
            raise ConflictError("Ya existe un usuario con ese correo electrónico.")

        role = self.user_repo.get_role_by_code(payload.role_code)
        if role is None:
            raise NotFoundError(f"El rol '{payload.role_code}' no existe.")

        user = User(
            role_id=role.id,
            full_name=payload.full_name.strip(),
            email=normalized_email,
            phone=payload.phone.strip() if payload.phone else None,
            password_hash=hash_password(payload.password),
            is_active=payload.is_active,
        )
        created = self.user_repo.create(user)
        commit_or_conflict(
            self.user_repo.db,
            "Ya existe un usuario con ese correo electrónico.",
        )
        return self.user_repo.get_by_id(created.id) or created

    def update_user(self, user_id: UUID, payload: UserUpdate, actor: User) -> User:
        is_admin = actor.role.code == "admin"
        if not is_admin and actor.id != user_id:
            raise ForbiddenError("No tiene permisos para modificar este usuario.")

        user = self.user_repo.get_by_id(user_id)
        if user is None:
            raise NotFoundError("Usuario no encontrado.")

        if (payload.role_code is not None or payload.is_active is not None) and not is_admin:
            raise ForbiddenError("Solo un administrador puede cambiar roles o estado de cuenta.")

        if actor.id == user_id:
            if payload.is_active is False:
                raise BusinessRuleError("Un administrador no puede desactivar su propia cuenta.")
            if payload.role_code is not None and payload.role_code != user.role.code:
                raise BusinessRuleError("Un administrador no puede cambiar su propio rol.")

        if payload.full_name is not None:
            user.full_name = payload.full_name.strip()
        if payload.phone is not None:
            user.phone = payload.phone.strip() or None
        if payload.password is not None:
            user.password_hash = hash_password(payload.password)
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.role_code is not None:
            role = self.user_repo.get_role_by_code(payload.role_code)
            if role is None:
                raise NotFoundError(f"El rol '{payload.role_code}' no existe.")
            user.role_id = role.id
            user.role = role

        commit_or_conflict(
            self.user_repo.db,
            "No fue posible actualizar el usuario por un conflicto de integridad.",
        )
        return self.user_repo.get_by_id(user.id) or user

    def list_roles(self) -> list[Role]:
        return self.user_repo.list_roles()
