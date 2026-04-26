import { api } from './api';

export type MapMarker =
  | { kind: 'country'; countryCode: string; lat: number; lon: number; count: number }
  | { kind: 'city'; city: string; countryCode: string; lat: number; lon: number; count: number }
  | {
      kind: 'individual';
      userId: string;
      name: string | null;
      avatarUrl: string | null;
      city: string | null;
      countryCode: string | null;
      lat: number;
      lon: number;
    }
  | {
      kind: 'association';
      associationId: string;
      name: string;
      logoUrl: string | null;
      city: string | null;
      countryCode: string | null;
      memberCount: number;
      isVerified: boolean;
      lat: number;
      lon: number;
    };

export interface GeoStats {
  totalMembers: number;
  countryCounts: Array<{ code: string; count: number }>;
}

export const geoApi = {
  async members(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
    type?: 'all' | 'people' | 'associations';
  }): Promise<MapMarker[]> {
    const { data } = await api.get<MapMarker[]>('/geo/members', { params: bounds });
    return data;
  },
  async stats(): Promise<GeoStats> {
    const { data } = await api.get<GeoStats>('/geo/stats');
    return data;
  },
  async nearby(params: { lat: number; lon: number; radius?: number; limit?: number }) {
    const { data } = await api.get('/geo/nearby', { params });
    return data;
  },
};
