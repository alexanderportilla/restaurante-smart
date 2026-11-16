from fastapi import APIRouter, Depends

from app.api.dependencies import get_user_service, require_roles
from app.models.auth import User
from app.schemas.users import RoleResponse
from app.services.user_service import UserService

router = APIRouter(prefix="/roles", tags=["Roles y Permisos"])


@router.get("", response_model=list[RoleResponse])
def list_roles(
    _actor: User = Depends(require_roles("admin", "manager")),
    user_service: UserService = Depends(get_user_service),
) -> list[RoleResponse]:
    return user_service.list_roles()
