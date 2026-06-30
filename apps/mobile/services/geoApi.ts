import type {
  ProximityActionResult,
  ProximityEncounterSummary,
  ProximityPingResult,
} from '@nigerconnect/shared-types';
import { api } from './api';

/**
 * A city result from the GET /geo/cities endpoint.
 * `lat` and `lng` are WGS-84 coordinates (no jitter at this stage — jitter is
 * applied by the server only when the coords are stored at registration).
 */
export interface CityResult {
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  population: number;
}

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
      /** Online now (Redis presence) — drives the live pulsing halo on the map. */
      activeRecently?: boolean;
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
    }
  | {
      kind: 'page';
      pageId: string;
      name: string;
      pageKind: string;
      avatarUrl: string | null;
      city: string | null;
      countryCode: string | null;
      followerCount: number;
      isVerified: boolean;
      lat: number;
      lon: number;
    };

export interface GeoStats {
  totalMembers: number;
  countryCounts: Array<{ code: string; count: number }>;
}

/** A visible member returned by GET /geo/country/:code (privacy-filtered). */
export interface CountryMember {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  identityStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  isAmbassador: boolean;
}

export interface CountryMembersPage {
  items: CountryMember[];
  nextCursor: string | null;
  /** Total visible members in the country (first page only). */
  total?: number;
}

export const geoApi = {
  /**
   * Search world cities for the registration autocomplete.
   * Calls GET /geo/cities — public endpoint, no JWT needed.
   *
   * @param q        Prefix/substring to search (e.g. "par", "niam")
   * @param opts.country  Optional ISO-2 country filter (e.g. "FR")
   * @param opts.limit    Max results (1–20, default 20)
   */
  async searchCities(
    q: string,
    opts?: { country?: string; limit?: number },
  ): Promise<CityResult[]> {
    const { data } = await api.get<CityResult[]>('/geo/cities', {
      params: { q, ...opts },
    });
    return data;
  },

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
  /** List the visible members of a country, optionally narrowed to a city (paginated). */
  async countryMembers(
    code: string,
    opts?: { city?: string; cursor?: string },
  ): Promise<CountryMembersPage> {
    const params: Record<string, string> = {};
    if (opts?.city) params.city = opts.city;
    if (opts?.cursor) params.cursor = opts.cursor;
    const { data } = await api.get<CountryMembersPage>(`/geo/country/${code}`, {
      params: Object.keys(params).length ? params : undefined,
    });
    return data;
  },
  async nearby(params: { lat: number; lon: number; radius?: number; limit?: number }) {
    const { data } = await api.get('/geo/nearby', { params });
    return data;
  },
  async proximityPing(params: {
    lat: number;
    lon: number;
  }): Promise<ProximityPingResult> {
    const { data } = await api.post<ProximityPingResult>('/geo/proximity/ping', params);
    return data;
  },

  // ── Proximity encounters (double-blind) ──────────────────────────────────
  async listEncounters(): Promise<ProximityEncounterSummary[]> {
    const { data } = await api.get<ProximityEncounterSummary[]>('/geo/proximity/encounters');
    return data;
  },
  async connectEncounter(encounterId: string): Promise<ProximityActionResult> {
    const { data } = await api.post<ProximityActionResult>(
      `/geo/proximity/encounters/${encounterId}/connect`,
    );
    return data;
  },
  async acceptEncounter(encounterId: string): Promise<ProximityActionResult> {
    const { data } = await api.post<ProximityActionResult>(
      `/geo/proximity/encounters/${encounterId}/accept`,
    );
    return data;
  },
  async declineEncounter(encounterId: string): Promise<ProximityActionResult> {
    const { data } = await api.post<ProximityActionResult>(
      `/geo/proximity/encounters/${encounterId}/decline`,
    );
    return data;
  },
};
