from uuid import UUID

from app.core.exceptions import NotFoundError
from app.models.auth import User
from app.models.orders import Notification
from app.repositories.notification_repository import NotificationRepository


class NotificationService:
    """Servicio de registro automático y consulta de notificaciones."""

    def __init__(self, notification_repo: NotificationRepository) -> None:
        self.notification_repo = notification_repo

    def add_notification(
        self,
        *,
        user_id: UUID | None,
        event_type: str,
        title: str,
        message: str,
        reference_type: str,
        reference_id: UUID,
        channel: str = "in_app",
    ) -> Notification:
        """Registra una notificación dentro de la transacción en curso."""
        notification = Notification(
            user_id=user_id,
            channel=channel,
            event_type=event_type,
            title=title,
            message=message,
            reference_type=reference_type,
            reference_id=reference_id,
            status="sent",
            is_read=False,
        )
        return self.notification_repo.create(notification)

    def list_user_notifications(
        self,
        *,
        user_id: UUID,
        unread_only: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Notification], int]:
        return self.notification_repo.list_for_user(
            user_id=user_id,
            unread_only=unread_only,
            limit=limit,
            offset=offset,
        )

    def mark_as_read(self, notification_id: UUID, actor: User) -> Notification:
        notification = self.notification_repo.get_by_id(notification_id)
        if notification is None or notification.user_id != actor.id:
            raise NotFoundError("Notificación no encontrada.")
        notification.is_read = True
        self.notification_repo.db.commit()
        self.notification_repo.db.refresh(notification)
        return notification
