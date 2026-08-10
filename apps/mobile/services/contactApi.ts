import { api } from './api';

/** Motif du message — pilote le tri dans la console admin. */
export type ContactTopic = 'partnership' | 'info' | 'problem' | 'other';

export interface CreateContactInput {
  topic: ContactTopic;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}

export interface CreatedContact {
  id: string;
  createdAt: string;
}

export const contactApi = {
  async send(input: CreateContactInput): Promise<CreatedContact> {
    const { data } = await api.post<CreatedContact>('/contact', input);
    return data;
  },
};
