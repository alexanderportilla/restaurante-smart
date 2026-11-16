from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_current_user, get_user_service, require_roles
from app.models.auth import User
from app.schemas.common import PaginatedResponse
from app.schemas.users import UserCreate, UserResponse, UserUpdate
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Usuarios"])


@router.get("", response_model=PaginatedResponse[UserResponse])
def list_users(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _actor: User = Depends(require_roles("admin", "manager")),
    user_service: UserService = Depends(get_user_service),
) -> PaginatedResponse[UserResponse]:
    items, total = user_service.list_users(limit=limit, offset=offset)
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _actor: User = Depends(require_roles("admin")),
    user_service: UserService = Depends(get_user_service),
) -> UserResponse:
    return user_service.create_user(payload)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    actor: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserResponse:
    return user_service.get_user(user_id, actor)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    actor: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserResponse:
    return user_service.update_user(user_id, payload, actor)
