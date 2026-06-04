import type { Poll, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export interface CreatePollInput {
  question: string;
  options: string[];
  multiChoice?: boolean;
  pageId?: string;
  expiresInHours?: number;
}

export const pollsApi = {
  async list(params?: {
    pageId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<Poll>> {
    const { data } = await api.get<CursorPage<Poll>>('/polls', { params });
    return data;
  },

  async get(id: string): Promise<Poll> {
    const { data } = await api.get<Poll>(`/polls/${id}`);
    return data;
  },

  async create(input: CreatePollInput): Promise<Poll> {
    const { data } = await api.post<Poll>('/polls', input);
    return data;
  },

  async vote(id: string, optionIds: string[]): Promise<Poll> {
    const { data } = await api.post<Poll>(`/polls/${id}/vote`, { optionIds });
    return data;
  },

  async retractVote(id: string): Promise<void> {
    await api.delete(`/polls/${id}/vote`);
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/polls/${id}`);
  },
};
