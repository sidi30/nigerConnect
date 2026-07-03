import type {
  CommunityPrice,
  CommunityPriceType,
  CommunityPriceVoteResult,
  CursorPage,
  RatesBanner,
  RatesToday,
} from '@nigerconnect/shared-types';
import { api } from './api';

/**
 * Payload for `POST /community-prices`. `submitterId` is NEVER sent — the API
 * always derives it from the JWT (anti-IDOR, mirror of ServiceInput/create).
 */
export interface CommunityPriceInput {
  type: CommunityPriceType;
  originCity?: string;
  originCountry?: string;
  destCity?: string;
  destCountry?: string;
  provider?: string;
  amount: number;
  currency: string;
  note?: string;
}

export type CommunityPriceUpdateInput = Partial<
  Pick<CommunityPriceInput, 'provider' | 'amount' | 'currency' | 'note'>
>;

export const ratesApi = {
  /** FX of the day (public). `source: 'unavailable'` before the first ECB fetch lands. */
  async today(): Promise<RatesToday> {
    const { data } = await api.get<RatesToday>('/rates/today');
    return data;
  },
  /** Feed banner = FX + one representative price per type, cached ~5min server-side. */
  async banner(): Promise<RatesBanner> {
    const { data } = await api.get<RatesBanner>('/rates/banner');
    return data;
  },
  async list(params?: {
    type?: CommunityPriceType;
    originCountry?: string;
    destCountry?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<CommunityPrice>> {
    const { data } = await api.get<CursorPage<CommunityPrice>>('/community-prices', { params });
    return data;
  },
  async mine(): Promise<CommunityPrice[]> {
    const { data } = await api.get<CommunityPrice[]>('/community-prices/mine');
    return data;
  },
  async get(id: string): Promise<CommunityPrice> {
    const { data } = await api.get<CommunityPrice>(`/community-prices/${id}`);
    return data;
  },
  async create(input: CommunityPriceInput): Promise<CommunityPrice> {
    const { data } = await api.post<CommunityPrice>('/community-prices', input);
    return data;
  },
  /** Owner-only. */
  async update(id: string, input: CommunityPriceUpdateInput): Promise<CommunityPrice> {
    const { data } = await api.patch<CommunityPrice>(`/community-prices/${id}`, input);
    return data;
  },
  /** Owner-only. */
  async remove(id: string): Promise<void> {
    await api.delete(`/community-prices/${id}`);
  },
  /** Toggle vote — same value twice retracts it. Anti-auto-vote (403) enforced server-side. */
  async vote(id: string, value: 1 | -1): Promise<CommunityPriceVoteResult> {
    const { data } = await api.post<CommunityPriceVoteResult>(`/community-prices/${id}/vote`, { value });
    return data;
  },
};

/**
 * Maps the API's error responses to clear French copy for the two cases the
 * spec calls out explicitly: throttle (429, daily submission cap or the
 * coarse per-IP vote guard) and anti-auto-vote (403, can't vote your own
 * report / can't vote removed content). Falls back to the server message or
 * a generic retry hint.
 */
export function describeCommunityPriceError(error: unknown): string {
  const err = error as {
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  };
  const status = err.response?.status;
  const apiMsg = err.response?.data?.message;
  const serverMessage = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;

  if (status === 429) {
    return serverMessage ?? 'Trop de tentatives, réessaie dans quelques minutes.';
  }
  if (status === 403) {
    return (
      serverMessage ??
      'Tu ne peux pas voter sur ton propre signalement, ni sur un contenu retiré.'
    );
  }
  if (status === 404) {
    return 'Ce signalement n’existe plus.';
  }
  return serverMessage ?? err.message ?? 'Une erreur est survenue, réessaie.';
}
