from app.core.config import get_settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnauthorizedError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.auth import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import CurrentUserResponse, LoginRequest, RegisterRequest, TokenResponse


def build_current_user_response(user: User) -> CurrentUserResponse:
    """Construye el esquema de usuario autenticado con permisos efectivos."""
    permissions = sorted({perm.code for perm in user.role.permissions})
    return CurrentUserResponse(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        is_active=user.is_active,
        role_code=user.role.code,
        role_name=user.role.name,
        permissions=permissions,
    )


class AuthService:
    """Servicio de registro, autenticación y emisión de tokens JWT."""

    def __init__(self, user_repo: UserRepository) -> None:
        self.user_repo = user_repo

    def register(self, payload: RegisterRequest) -> User:
        normalized_email = payload.email.lower().strip()
        if self.user_repo.get_by_email(normalized_email) is not None:
            raise ConflictError("Ya existe una cuenta registrada con ese correo electrónico.")

        customer_role = self.user_repo.get_role_by_code("customer")
        if customer_role is None:
            raise NotFoundError("No se encontró el rol base 'customer' en la base de datos.")

        user = User(
            role_id=customer_role.id,
            full_name=payload.full_name.strip(),
            email=normalized_email,
            phone=payload.phone.strip() if payload.phone else None,
            password_hash=hash_password(payload.password),
            is_active=True,
        )
        created = self.user_repo.create(user)
        self.user_repo.db.commit()
        return self.user_repo.get_by_id(created.id) or created

    def login(self, payload: LoginRequest) -> TokenResponse:
        user = self.user_repo.get_by_email(payload.email)
        if user is None or not verify_password(payload.password, user.password_hash):
            raise UnauthorizedError("Correo electrónico o contraseña incorrectos.")
        if not user.is_active:
            raise ForbiddenError("La cuenta de usuario está desactivada.")

        settings = get_settings()
        token = create_access_token(subject=user.id, role=user.role.code)
        return TokenResponse(
            access_token=token,
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=build_current_user_response(user),
        )
