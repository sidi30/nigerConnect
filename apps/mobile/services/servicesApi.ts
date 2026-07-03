import type {
  ServiceRequest,
  ServiceResponse,
  CursorPage,
  ServiceCategory,
  ServiceIntent,
  ServiceUrgency,
  ServiceStatus,
} from '@nigerconnect/shared-types';
import { api } from './api';

/**
 * Media item sent when creating/updating a service. `mediaUrl` MUST be an
 * owner-bound URL returned by the presign/upload flow (never a local file
 * URI) — the backend re-binds each one via `assertOwnedPublicImage`.
 */
export interface ServiceMediaInput {
  mediaUrl: string;
  thumbnailUrl?: string;
  mediaType?: 'image';
  width?: number;
  height?: number;
  blurhash?: string;
  sortOrder?: number;
}

export interface ServiceInput {
  intent?: ServiceIntent;
  title: string;
  description?: string;
  category: ServiceCategory;
  urgency?: ServiceUrgency;
  /** Only meaningful for `paid_service`; the API rejects it on `help_free`. */
  budget?: string;
  city?: string;
  countryCode?: string;
  media?: ServiceMediaInput[];
}

export const servicesApi = {
  async list(params?: {
    intent?: ServiceIntent;
    category?: ServiceCategory;
    country?: string;
    urgency?: ServiceUrgency;
    status?: ServiceStatus;
    q?: string;
    sort?: 'recent' | 'urgent_first';
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<ServiceRequest>> {
    const { data } = await api.get<CursorPage<ServiceRequest>>('/services', { params });
    return data;
  },
  /** Detail + ordered `media[]` gallery. */
  async get(id: string): Promise<ServiceRequest> {
    const { data } = await api.get<ServiceRequest>(`/services/${id}`);
    return data;
  },
  async create(input: ServiceInput): Promise<ServiceRequest> {
    const { data } = await api.post<ServiceRequest>('/services', input);
    return data;
  },
  /** Owner-only. A provided `media` array REPLACES the whole gallery. */
  async update(id: string, input: Partial<ServiceInput>): Promise<ServiceRequest> {
    const { data } = await api.patch<ServiceRequest>(`/services/${id}`, input);
    return data;
  },
  /** Owner-only. Cascades media/responses/ratings server-side. */
  async remove(id: string): Promise<void> {
    await api.delete(`/services/${id}`);
  },
  async respond(id: string, message: string): Promise<ServiceResponse> {
    const { data } = await api.post<ServiceResponse>(`/services/${id}/respond`, { message });
    return data;
  },
  async responses(id: string): Promise<ServiceResponse[]> {
    const { data } = await api.get<ServiceResponse[]>(`/services/${id}/responses`);
    return data;
  },
  async resolve(id: string) {
    await api.patch(`/services/${id}/resolve`);
  },
};
