import type { User, CursorPage, Post, PublicUser } from '@nigerconnect/shared-types';
import { api, BASE_URL } from './api';
import { tokenStore } from './secureStore';

export const profileApi = {
  async me(): Promise<User> {
    const { data } = await api.get<{ user: User }>('/profile/me');
    return data.user;
  },

  async updateMe(input: Partial<User>): Promise<User> {
    const { data } = await api.patch<{ user: User }>('/profile/me', input);
    return data.user;
  },

  /**
   * Avatar / cover live on dedicated routes because their Zod schemas accept
   * a `null` to clear the field, which `updateProfileSchema` doesn't. Calling
   * `updateMe({ avatarUrl })` was a silent no-op (the field was stripped),
   * which is why "définir comme photo de profil" looked broken.
   */
  async updateAvatar(avatarUrl: string | null): Promise<User> {
    const { data } = await api.patch<{ user: User }>('/profile/me/avatar', { avatarUrl });
    return data.user;
  },

  async updateCover(coverUrl: string | null): Promise<User> {
    const { data } = await api.patch<{ user: User }>('/profile/me/cover', { coverUrl });
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

  /**
   * RGPD article 20 — fetch the data export as raw JSON. Returns the parsed
   * payload so the caller can either save it locally (Sharing API) or render
   * a preview. Throttled server-side to once a minute / 5 a day.
   */
  async exportMyData(): Promise<unknown> {
    const token = await tokenStore.getAccess();
    if (!token) throw new Error('Non authentifié');
    const res = await fetch(`${BASE_URL}/api/profile/me/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Export impossible (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return res.json();
  },
};
