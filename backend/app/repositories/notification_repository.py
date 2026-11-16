from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orders import Notification
from app.repositories.base import paginate_scalars


class NotificationRepository:
    """Acceso a datos para notificaciones automáticas."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, notification_id: UUID) -> Notification | None:
        return self.db.get(Notification, notification_id)

    def list_for_user(
        self,
        *,
        user_id: UUID,
        unread_only: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Notification], int]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        return paginate_scalars(self.db, stmt, limit=limit, offset=offset)

    def create(self, notification: Notification) -> Notification:
        self.db.add(notification)
        self.db.flush()
        self.db.refresh(notification)
        return notification
