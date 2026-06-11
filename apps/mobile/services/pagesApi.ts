import type { Page, PageKind, PageRole, PageWithViewer, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export type { PageKind, PageRole };

export interface CreatePageInput {
  name: string;
  description?: string;
  kind: PageKind;
  avatarUrl?: string;
  coverUrl?: string;
  // Required: the map filters out pages with no countryCode, so creation must
  // carry a place. update() relaxes this via Partial<CreatePageInput>.
  countryCode: string;
  city: string;
  website?: string;
  contactEmail?: string;
}

export interface PageAdmin {
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
  };
  role: PageRole;
  createdAt: string;
}

export const pagesApi = {
  async list(params?: {
    kind?: PageKind;
    country?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<Page>> {
    const { data } = await api.get<CursorPage<Page>>('/pages', { params });
    return data;
  },

  async mine(): Promise<(Page & { myRole: PageRole })[]> {
    const { data } = await api.get<(Page & { myRole: PageRole })[]>('/pages/mine');
    return data;
  },

  async get(id: string): Promise<PageWithViewer> {
    const { data } = await api.get<PageWithViewer>(`/pages/${id}`);
    return data;
  },

  async create(input: CreatePageInput): Promise<Page> {
    const { data } = await api.post<Page>('/pages', input);
    return data;
  },

  async update(id: string, input: Partial<CreatePageInput>): Promise<Page> {
    const { data } = await api.patch<Page>(`/pages/${id}`, input);
    return data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/pages/${id}`);
  },

  async follow(id: string): Promise<{ following: true }> {
    const { data } = await api.post<{ following: true }>(`/pages/${id}/follow`);
    return data;
  },

  async unfollow(id: string): Promise<void> {
    await api.delete(`/pages/${id}/follow`);
  },

  async admins(id: string): Promise<PageAdmin[]> {
    const { data } = await api.get<PageAdmin[]>(`/pages/${id}/admins`);
    return data;
  },

  async setAdmin(id: string, userId: string, role: PageRole): Promise<void> {
    await api.patch(`/pages/${id}/admins/${userId}`, { role });
  },

  async removeAdmin(id: string, userId: string): Promise<void> {
    await api.delete(`/pages/${id}/admins/${userId}`);
  },
};
