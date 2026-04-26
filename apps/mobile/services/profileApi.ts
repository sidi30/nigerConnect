import type { User, CursorPage, Post, PublicUser } from '@nigerconnect/shared-types';
import { api } from './api';

export const profileApi = {
  async me(): Promise<User> {
    const { data } = await api.get<{ user: User }>('/profile/me');
    return data.user;
  },

  async updateMe(input: Partial<User>): Promise<User> {
    const { data } = await api.patch<{ user: User }>('/profile/me', input);
    return data.user;
  },

  async search(params: {
    q?: string;
    country?: string;
    city?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<User>> {
    const { data } = await api.get<CursorPage<User>>('/profile/search', { params });
    return data;
  },

  async getById(id: string): Promise<User> {
    const { data } = await api.get<{ user: User }>(`/profile/${id}`);
    return data.user;
  },

  async getFriendsOf(id: string, cursor?: string): Promise<CursorPage<PublicUser>> {
    const { data } = await api.get<CursorPage<PublicUser>>(`/profile/${id}/friends`, {
      params: { cursor },
    });
    return data;
  },

  async getUserPosts(id: string, cursor?: string): Promise<CursorPage<Post>> {
    const { data } = await api.get<CursorPage<Post>>(`/users/${id}/posts`, {
      params: { cursor },
    });
    return data;
  },

  /** RGPD — hard-delete the account. Server cascades posts, comments, messages, etc. */
  async deleteAccount(): Promise<void> {
    await api.delete('/profile/me');
  },
};
