import { httpClient } from './httpClient';
import type { NotificationRecord, PaginatedResponse } from '../types/api';

export const notificationsService = {
  async listNotifications(
    unreadOnly = false,
    limit = 20,
    offset = 0,
  ): Promise<PaginatedResponse<NotificationRecord>> {
    const { data } = await httpClient.get<PaginatedResponse<NotificationRecord>>(
      '/notifications',
      {
        params: { unread_only: unreadOnly, limit, offset },
      },
    );
    return data;
  },

  async markAsRead(notificationId: string): Promise<NotificationRecord> {
    const { data } = await httpClient.patch<NotificationRecord>(
      `/notifications/${notificationId}/read`,
    );
    return data;
  },
};
