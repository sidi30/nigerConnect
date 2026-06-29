import type { PublicUser, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export interface FriendRequest {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  requester: PublicUser;
  addressee?: PublicUser;
}

export interface FriendSuggestion {
  user: PublicUser;
  mutualFriends: number;
  sameCity: boolean;
  sameCountry: boolean;
  score: number;
}

export const friendsApi = {
  async list(cursor?: string): Promise<CursorPage<PublicUser>> {
    const { data } = await api.get<CursorPage<PublicUser>>('/friends', { params: { cursor } });
    return data;
  },
  /** Type-ahead for @mentions: accepted friends matching a name query. */
  async search(q: string): Promise<PublicUser[]> {
    const { data } = await api.get<{ items: PublicUser[] }>('/friends/search', { params: { q } });
    return data.items;
  },
  async incoming(): Promise<FriendRequest[]> {
    const { data } = await api.get<FriendRequest[]>('/friends/requests');
    return data;
  },
  async outgoing(): Promise<FriendRequest[]> {
    const { data } = await api.get<FriendRequest[]>('/friends/requests/sent');
    return data;
  },
  async suggestions(limit = 20): Promise<FriendSuggestion[]> {
    const { data } = await api.get<FriendSuggestion[]>('/friends/suggestions', { params: { limit } });
    return data;
  },
  async sendRequest(userId: string) {
    await api.post(`/friends/request/${userId}`);
  },
  async accept(friendshipId: string) {
    await api.post(`/friends/accept/${friendshipId}`);
  },
  async decline(friendshipId: string) {
    await api.post(`/friends/decline/${friendshipId}`);
  },
  async remove(userId: string) {
    await api.delete(`/friends/${userId}`);
  },
  async relationship(userId: string): Promise<{
    status: 'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none';
    friendshipId: string | null;
  }> {
    const { data } = await api.get<{
      status: 'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none';
      friendshipId: string | null;
    }>(`/friends/relationship/${userId}`);
    return data;
  },
  async mutual(userId: string) {
    const { data } = await api.get(`/friends/mutual/${userId}`);
    return data as Array<{
      id: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
    }>;
  },
};
