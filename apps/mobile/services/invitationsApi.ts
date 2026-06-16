import { api } from './api';

/** Two kinds of invitation since the v2 "network" rework. */
export type InvitationKind = 'single_use' | 'reusable';

export interface InvitationCheckResult {
  valid: boolean;
  inviterName?: string;
  kind?: InvitationKind;
}

export interface CreatedInvitation {
  id: string;
  code: string;
  url: string;
  kind: InvitationKind;
}

export interface InvitationItem {
  id: string;
  code: string;
  kind: InvitationKind;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  acceptedBy?: { id: string; displayName: string | null; avatarUrl?: string | null } | null;
  /** For `reusable`: number of accounts that signed up via this link. `single_use`: 0 or 1. */
  signupsCount: number;
  url: string;
  createdAt: string;
}

export interface InvitationsListResult {
  /** Whether the current user is allowed to create mass (`reusable`) links. */
  canBulkInvite: boolean;
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

  /**
   * Create an invitation. `email` sends a single-use invite to that address;
   * `kind: 'reusable'` mints a shareable mass link (requires the `canBulkInvite`
   * right server-side). No quota, no expiration anymore.
   */
  async create(input?: { email?: string; kind?: InvitationKind }): Promise<CreatedInvitation> {
    const body =
      input && (input.email || input.kind)
        ? { ...(input.email ? { email: input.email } : {}), ...(input.kind ? { kind: input.kind } : {}) }
        : undefined;
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
