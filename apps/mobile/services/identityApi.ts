import { api } from './api';

export interface IdentityStatus {
  status: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  latestSubmission: string | null;
  rejectionReason: string | null;
}

export const identityApi = {
  async status(): Promise<IdentityStatus> {
    const { data } = await api.get<IdentityStatus>('/auth/identity/status');
    return data;
  },
  async submit(input: { documentType: string; fileUrl: string }) {
    await api.post('/auth/identity/submit', input);
  },
};
