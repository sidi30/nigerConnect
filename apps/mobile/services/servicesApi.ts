import type { ServiceRequest, ServiceResponse, CursorPage, ServiceCategory, ServiceUrgency, ServiceStatus } from '@nigerconnect/shared-types';
import { api } from './api';

export const servicesApi = {
  async list(params?: {
    category?: ServiceCategory;
    country?: string;
    urgency?: ServiceUrgency;
    status?: ServiceStatus;
    sort?: 'recent' | 'urgent_first';
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<ServiceRequest>> {
    const { data } = await api.get<CursorPage<ServiceRequest>>('/services', { params });
    return data;
  },
  async get(id: string): Promise<ServiceRequest> {
    const { data } = await api.get<ServiceRequest>(`/services/${id}`);
    return data;
  },
  async create(input: {
    title: string;
    description?: string;
    category: ServiceCategory;
    urgency?: ServiceUrgency;
    budget?: string;
    city?: string;
    countryCode?: string;
  }): Promise<ServiceRequest> {
    const { data } = await api.post<ServiceRequest>('/services', input);
    return data;
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
