import type { Notification, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export const notificationApi = {
  async list(cursor?: string): Promise<CursorPage<Notification>> {
    const { data } = await api.get<CursorPage<Notification>>('/notifications', { params: { cursor } });
    return data;
  },
  async unreadCount(): Promise<number> {
    const { data } = await api.get<{ count: number }>('/notifications/unread-count');
    return data.count;
  },
  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`);
  },
  async markAllRead(): Promise<void> {
    await api.patch('/notifications/read-all');
  },
  async registerDevice(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    await api.post('/notifications/register-device', { token, platform });
  },
};
