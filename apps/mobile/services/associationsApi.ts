import type { Association, AssociationMember, AssociationEvent, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export interface MyAssociation extends Association {
  role: 'admin' | 'moderator' | 'member';
  joinedAt: string;
}

export type AssociationCategory =
  | 'generaliste'
  | 'etudiants'
  | 'femmes'
  | 'jeunesse'
  | 'culture'
  | 'business'
  | 'sport'
  | 'religieux';

export interface CreateAssociationInput {
  name: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  category: AssociationCategory;
  // Required: the map filters out orgs with no countryCode, so creation must
  // carry a place. update() relaxes this via Partial<CreateAssociationInput>.
  countryCode: string;
  city: string;
  website?: string;
  contactEmail?: string;
  requiresApproval?: boolean;
}

export interface PendingMember {
  userId: string;
  associationId: string;
  joinedAt: string;
  user: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
    city: string | null;
    countryCode: string | null;
  };
}

export const associationsApi = {
  async list(params?: { category?: string; country?: string; cursor?: string; limit?: number }): Promise<CursorPage<Association>> {
    const { data } = await api.get<CursorPage<Association>>('/associations', { params });
    return data;
  },
  async mine(): Promise<MyAssociation[]> {
    const { data } = await api.get<MyAssociation[]>('/associations/mine');
    return data;
  },
  async get(id: string): Promise<Association & { events: AssociationEvent[] }> {
    const { data } = await api.get<Association & { events: AssociationEvent[] }>(`/associations/${id}`);
    return data;
  },
  async create(input: CreateAssociationInput): Promise<Association> {
    const { data } = await api.post<Association>('/associations', input);
    return data;
  },
  async update(id: string, input: Partial<CreateAssociationInput>): Promise<Association> {
    const { data } = await api.patch<Association>(`/associations/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/associations/${id}`);
  },
  async join(id: string): Promise<{ pending: boolean }> {
    const { data } = await api.post<{ pending: boolean }>(`/associations/${id}/join`);
    return data;
  },
  async leave(id: string) {
    await api.delete(`/associations/${id}/leave`);
  },
  async members(id: string): Promise<CursorPage<AssociationMember>> {
    const { data } = await api.get<CursorPage<AssociationMember>>(`/associations/${id}/members`);
    return data;
  },
  async pending(id: string): Promise<CursorPage<PendingMember>> {
    const { data } = await api.get<CursorPage<PendingMember>>(`/associations/${id}/pending`);
    return data;
  },
  async invite(id: string, userId: string): Promise<void> {
    await api.post(`/associations/${id}/invite`, { userId });
  },
  async approve(id: string, userId: string) {
    await api.post(`/associations/${id}/members/${userId}/approve`);
  },
  async reject(id: string, userId: string, reason?: string) {
    await api.post(`/associations/${id}/members/${userId}/reject`, { reason });
  },
  async events(id: string): Promise<AssociationEvent[]> {
    const { data } = await api.get<AssociationEvent[]>(`/associations/${id}/events`);
    return data;
  },
  async upcomingEvents(): Promise<AssociationEvent[]> {
    const { data } = await api.get<AssociationEvent[]>('/events/upcoming');
    return data;
  },
};
