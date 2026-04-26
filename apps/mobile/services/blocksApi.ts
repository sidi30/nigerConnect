import type { PublicUser } from '@nigerconnect/shared-types';
import { api } from './api';

export interface BlockEntry {
  blockerId: string;
  blockedId: string;
  createdAt: string;
  blocked: PublicUser;
}

export const blocksApi = {
  async list(): Promise<BlockEntry[]> {
    const { data } = await api.get<BlockEntry[]>('/blocks');
    return data;
  },
  async block(userId: string) {
    await api.post(`/blocks/${userId}`);
  },
  async unblock(userId: string) {
    await api.delete(`/blocks/${userId}`);
  },
};
