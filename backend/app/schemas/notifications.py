from datetime import datetime
from uuid import UUID

from app.schemas.common import ORMBaseSchema


class NotificationResponse(ORMBaseSchema):
    id: UUID
    user_id: UUID | None
    channel: str
    event_type: str
    title: str
    message: str
    reference_type: str
    reference_id: UUID
    status: str
    is_read: bool
    sent_at: datetime | None
    created_at: datetime
