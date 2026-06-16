import { api } from './api';

export interface InvitationCheckResult {
  valid: boolean;
  inviterName?: string;
}

export interface CreatedInvitation {
  id: string;
  code: string;
  url: string;
  expiresAt: string | null;
}

export interface InvitationItem {
  id: string;
  code: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  acceptedBy?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface InvitationsListResult {
  quota: number;
  used: number;
  available: number;
  invites: InvitationItem[];
}

export type RegistrationMode = 'open' | 'invite_only' | 'closed';

export const invitationsApi = {
  async getRegistrationMode(): Promise<RegistrationMode> {
    const { data } = await api.get<{ mode: RegistrationMode }>('/auth/registration-mode');
    return data.mode;
  },

  async checkCode(code: string): Promise<InvitationCheckResult> {
    const { data } = await api.get<InvitationCheckResult>('/invitations/check', {
      params: { code },
    });
    return data;
  },

  async create(email?: string): Promise<CreatedInvitation> {
    const body = email ? { email } : undefined;
    const { data } = await api.post<CreatedInvitation>('/invitations', body);
    return data;
  },

  async list(): Promise<InvitationsListResult> {
    const { data } = await api.get<InvitationsListResult>('/invitations');
    return data;
  },

  async revoke(id: string): Promise<void> {
    await api.post(`/invitations/${id}/revoke`);
  },
};
