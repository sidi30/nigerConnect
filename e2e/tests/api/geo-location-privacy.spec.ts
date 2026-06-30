/**
 * geo-location-privacy.spec.ts
 *
 * Regression guard for three location-privacy bug fixes applied to NigerConnect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG1 (HIGH) — Proximity ping must NEVER leak live GPS to public map surfaces.
 *
 *   POST /api/geo/proximity/ping writes the caller's GPS to the PRIVATE
 *   proximity_lat/proximity_lon columns only. The public latitude/longitude
 *   (used by /geo/members individual markers and /geo/nearby) must stay at
 *   city-centroid coarseness (geocoded + jitter, set at registration/PATCH).
 *
 *   Covered:
 *     1a. DB: proximity_lat/lon ≈ ping GPS; latitude/longitude unchanged.
 *     1b. Map (/geo/members zoom≥9): pinger marker stays near Niamey after Paris ping.
 *     1c. /geo/nearby: pinger appears with Niamey coords, not Paris GPS.
 *     1d. Positive: two seeded users within 1 km match each other (feature works).
 *     1e. Private-profile user: matches=[] regardless of proximity.
 *     1f. show_on_map=false user: matches=[] AND no GPS written to proximity cols.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG2 (MEDIUM) — showOnMap is OFF by default for all new registrations.
 *
 *   Covered:
 *     2a. Register response carries showOnMap=false; DB confirms.
 *     2b. GET /api/auth/me confirms showOnMap=false.
 *     2c. User absent from individual map pins before opting in;
 *         appears after PATCH showOnMap=true + cache flush.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG3 (LOW) — PATCH /api/profile/me must never store raw client GPS verbatim.
 *
 *   Covered:
 *     3a. Coords within 150 km of city centroid → jittered (stored ≠ exact input).
 *     3b. Coords > 150 km from city centroid → server-geocoded centroid+jitter.
 *     3c. City change without explicit coords → re-geocoded from new city.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Haversine-based assertions replace strict float equality everywhere coords
 * may have been jittered. "LARGE" / "SMALL" terminology:
 *   SMALL  < 10 km  — within normal jitter range (±0.02° ≈ 2.2 km max)
 *   LARGE  > 500 km — at least continent-scale separation
 *
 * Prerequisites:
 *   API running on API_BASE_URL (default http://127.0.0.1:3000)
 *   Postgres accessible via DATABASE_URL env or docker exec nigerconnect-postgres
 *   Redis    accessible via REDIS_URL    env or docker exec nigerconnect-redis
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql, redisDel } from './_db-exec';

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// Hardcoded centroid from apps/api/src/common/geo/city-coords.ts
const NIAMEY_CENTROID = { lat: 13.5116, lon: 2.1254 } as const;
// COORD_JITTER_DEGREES = 0.04 (full span); max offset = ±0.02° ≈ ±2.2 km.
// Allow 10 km to absorb two stacked jitter applications (register + PATCH).
const JITTER_SAFE_KM = 10;

// Paris GPS — sent as the "live" proximity ping; ~4 900 km from Niamey
const PARIS_GPS = { lat: 48.8566, lon: 2.3522 } as const;
// London GPS — used as a far-away claimed coord for BUG3
const LONDON_GPS = { lat: 51.5074, lon: -0.1278 } as const;

// Niger bounding box large enough to contain Niamey (~13.5°N, ~2.1°E).
// zoom=12 → getMarkers() calls individuals() → individual-pin markers.
const NIGER_BBOX = { north: 24, south: 11, east: 16, west: 0 } as const;
// Paris bounding box used to confirm the pinger's pin did NOT move there.
const PARIS_BBOX = { north: 49, south: 48, east: 3, west: 1 } as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2egeoprivacy'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair { accessToken: string; refreshToken: string }
interface AuthResponse {
  user: { id: string; email: string; showOnMap?: unknown; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(
  request: APIRequestContext,
  extra: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const email = randomEmail();
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'GeoPriv',
      lastName: 'E2E',
      ...extra,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

function authHdr(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function enableShowOnMap(userId: string): void {
  psql(`UPDATE users SET show_on_map = true WHERE id = '${userId}';`);
}

function enableProximityAlerts(userId: string): void {
  psql(`UPDATE users SET proximity_alerts = true WHERE id = '${userId}';`);
}

function setProximityRadius(userId: string, meters: number): void {
  psql(`UPDATE users SET proximity_radius = ${meters} WHERE id = '${userId}';`);
}

/**
 * Seed a user's live proximity position directly — simulates a prior successful
 * ping so this user is a valid candidate in the next ping's matching window.
 */
function seedProximityCoords(userId: string, lat: number, lon: number): void {
  psql(
    `UPDATE users
        SET proximity_lat = ${lat},
            proximity_lon = ${lon},
            proximity_updated_at = NOW()
      WHERE id = '${userId}';`,
  );
}

interface GeoRow {
  latitude: number | null;
  longitude: number | null;
  proximity_lat: number | null;
  proximity_lon: number | null;
}

/** Read the public and private coordinate columns for a user directly from DB. */
function getGeoRow(userId: string): GeoRow | null {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT latitude::float,
              longitude::float,
              proximity_lat::float,
              proximity_lon::float
         FROM users
        WHERE id = '${userId}'::uuid
     ) t;`,
  );
  const match = out.match(/\{.*\}/);
  return match ? (JSON.parse(match[0]) as GeoRow) : null;
}

/**
 * Master kill-switch for the proximity-encounter feature (ships DARK). The
 * service reads it via SettingsService, which caches in Redis (write-through),
 * so we clear the cache key after flipping it.
 */
function setProximityEnabled(enabled: boolean): void {
  const v = enabled ? 'true' : 'false';
  psql(
    `INSERT INTO app_settings(key, value, updated_at)
       VALUES('proximity_enabled', '${v}', NOW())
       ON CONFLICT (key) DO UPDATE SET value = '${v}', updated_at = NOW();`,
  );
  redisDel('setting:proximity_enabled');
}

/**
 * Make a user proximity-eligible: identity approved + an approved ID document
 * carrying an adult DOB (the 18+ gate). Proximity is now decoupled from the map
 * (show_on_map / privacy_level no longer gate it) — identity does.
 */
function makeProximityEligible(userId: string): void {
  psql(`UPDATE users SET identity_status = 'approved' WHERE id = '${userId}';`);
  psql(
    `INSERT INTO identity_documents(id, user_id, document_type, file_url, status, date_of_birth, created_at)
       VALUES(gen_random_uuid(), '${userId}', 'passport', 'https://example.test/id.jpg', 'approved', '1990-01-01', NOW());`,
  );
}

function getShowOnMapFromDb(userId: string): boolean {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT show_on_map FROM users WHERE id = '${userId}'::uuid
     ) t;`,
  );
  const match = out.match(/\{.*\}/);
  if (!match) return false;
  return (JSON.parse(match[0]) as { show_on_map: boolean }).show_on_map;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Great-circle distance in km (Haversine). */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG1: Proximity ping must not leak live GPS to public map surfaces
// ─────────────────────────────────────────────────────────────────────────────

test.describe('BUG1 (HIGH): proximity ping must not leak live GPS to public map surfaces', () => {
  // Proximity ships DARK behind a kill-switch — enable it for this suite, and
  // make pingers identity-eligible (verified + 18+), the new gate that replaced
  // the show_on_map / privacy_level requirement.
  test.beforeAll(() => setProximityEnabled(true));
  test.afterAll(() => setProximityEnabled(false));

  /**
   * Core regression test: after pinging with a Paris GPS that is ~4 900 km from
   * Niamey, the pinger's public individual marker must stay near Niamey centroid
   * on both the /geo/members surface (zoom≥9) and the /geo/nearby surface.
   */
  test('1a-1c: after pinging with Paris GPS, public pin stays near Niamey on all map surfaces', async ({
    request,
  }) => {
    // ── Pinger: Niamey NE, opted in to map + proximity ───────────────────────
    const { user: pinger, tokens: pingerTokens } = await register(request, {
      city: 'Niamey',
      countryCode: 'NE',
    });
    verifyEmailInDb(pinger.id);
    enableShowOnMap(pinger.id);
    enableProximityAlerts(pinger.id);
    makeProximityEligible(pinger.id);

    // Observer: needed because individuals() excludes the viewer themselves.
    // Uses Paris FR so the observer's own pin doesn't interfere with Niamey bbox.
    const { user: observer, tokens: observerTokens } = await register(request, {
      city: 'Paris',
      countryCode: 'FR',
    });
    verifyEmailInDb(observer.id);

    // ── Baseline: pinger's public DB coords are near Niamey centroid ─────────
    const beforeRow = getGeoRow(pinger.id);
    expect(beforeRow, 'pinger must have a DB row after registration').not.toBeNull();
    expect(
      beforeRow!.latitude,
      'pinger must have non-null latitude set at registration',
    ).not.toBeNull();
    expect(
      beforeRow!.longitude,
      'pinger must have non-null longitude set at registration',
    ).not.toBeNull();

    const initDistToNiamey = haversineKm(
      beforeRow!.latitude!, beforeRow!.longitude!,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    expect(
      initDistToNiamey,
      `initial public coords must be near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${initDistToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);

    // ── Send proximity ping with Paris GPS (~4 900 km from Niamey) ───────────
    const pingRes = await request.post(`${BASE_URL}/api/geo/proximity/ping`, {
      data: { lat: PARIS_GPS.lat, lon: PARIS_GPS.lon },
      headers: authHdr(pingerTokens.accessToken),
    });
    expect(
      pingRes.status(),
      `POST /api/geo/proximity/ping → expected 200, got ${pingRes.status()}: ${await pingRes.text()}`,
    ).toBe(200);
    const pingBody = (await pingRes.json()) as { matches: unknown[] };
    expect(Array.isArray(pingBody.matches), 'ping response must include a matches array').toBe(true);
    // No one else is pinging in Paris in this test — matches must be empty
    expect(pingBody.matches, 'no candidates near Paris, so matches must be empty').toHaveLength(0);

    // ── 1a: DB assertion — private proximity_lat/lon = Paris GPS ─────────────
    const afterRow = getGeoRow(pinger.id);
    expect(afterRow, 'pinger DB row must exist after ping').not.toBeNull();

    // The private columns must now hold the live Paris position
    expect(
      afterRow!.proximity_lat,
      'proximity_lat must be set to the Paris ping GPS',
    ).not.toBeNull();
    expect(
      afterRow!.proximity_lon,
      'proximity_lon must be set to the Paris ping GPS',
    ).not.toBeNull();
    const proxDistToParis = haversineKm(
      afterRow!.proximity_lat!, afterRow!.proximity_lon!,
      PARIS_GPS.lat, PARIS_GPS.lon,
    );
    expect(
      proxDistToParis,
      `proximity_lat/lon must be near Paris GPS (stored exactly); got ${proxDistToParis.toFixed(3)} km`,
    ).toBeLessThan(1); // rounding tolerance

    // ── 1a: PUBLIC latitude/longitude must NOT have moved to Paris GPS ────────
    // The ping service writes ONLY to proximity_lat/lon — never to latitude/longitude.
    expect(
      afterRow!.latitude,
      'public latitude must be unchanged by the proximity ping',
    ).toBe(beforeRow!.latitude);
    expect(
      afterRow!.longitude,
      'public longitude must be unchanged by the proximity ping',
    ).toBe(beforeRow!.longitude);

    // Distance between public pin and Paris GPS must be planet-scale
    const publicDistToParis = haversineKm(
      afterRow!.latitude!, afterRow!.longitude!,
      PARIS_GPS.lat, PARIS_GPS.lon,
    );
    expect(
      publicDistToParis,
      `public coords must remain far from Paris ping GPS (Niamey→Paris ≈ 4 900 km); got ${publicDistToParis.toFixed(1)} km`,
    ).toBeGreaterThan(500);

    // Distance between public pin and Niamey centroid must stay small
    const publicDistToNiamey = haversineKm(
      afterRow!.latitude!, afterRow!.longitude!,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    expect(
      publicDistToNiamey,
      `public coords must remain near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${publicDistToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);

    // ── 1b: /geo/members (zoom=12) Paris bbox — pinger ABSENT ────────────────
    // Individual markers filter on latitude/longitude (public columns).
    // If the ping leaked the GPS, the pinger would appear in the Paris bbox.
    const parisMarkersRes = await request.get(
      `${BASE_URL}/api/geo/members` +
        `?north=${PARIS_BBOX.north}&south=${PARIS_BBOX.south}` +
        `&east=${PARIS_BBOX.east}&west=${PARIS_BBOX.west}&zoom=12&type=people`,
      { headers: authHdr(observerTokens.accessToken) },
    );
    expect(parisMarkersRes.status()).toBe(200);
    const parisMarkers = (await parisMarkersRes.json()) as Array<{
      kind: string;
      userId?: string;
    }>;
    expect(
      parisMarkers.find((m) => m.kind === 'individual' && m.userId === pinger.id),
      'pinger must NOT appear in Paris bbox individual markers after pinging with Paris GPS',
    ).toBeUndefined();

    // ── 1b: /geo/members (zoom=12) Niamey bbox — pinger PRESENT, near Niamey ─
    const niameyMarkersRes = await request.get(
      `${BASE_URL}/api/geo/members` +
        `?north=${NIGER_BBOX.north}&south=${NIGER_BBOX.south}` +
        `&east=${NIGER_BBOX.east}&west=${NIGER_BBOX.west}&zoom=12&type=people`,
      { headers: authHdr(observerTokens.accessToken) },
    );
    expect(niameyMarkersRes.status()).toBe(200);
    const niameyMarkers = (await niameyMarkersRes.json()) as Array<{
      kind: string;
      userId?: string;
      lat: number;
      lon: number;
    }>;

    const pingerMarker = niameyMarkers.find(
      (m) => m.kind === 'individual' && m.userId === pinger.id,
    );
    expect(
      pingerMarker,
      `pinger must still appear as individual marker in Niger bbox after pinging with Paris GPS`,
    ).toBeDefined();

    // The marker's coordinates must be near Niamey, NOT near Paris
    const markerToNiamey = haversineKm(
      pingerMarker!.lat, pingerMarker!.lon,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    const markerToParis = haversineKm(
      pingerMarker!.lat, pingerMarker!.lon,
      PARIS_GPS.lat, PARIS_GPS.lon,
    );
    expect(
      markerToNiamey,
      `individual marker must be near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${markerToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);
    expect(
      markerToParis,
      `individual marker must be far from the Paris GPS ping (>> 500 km); got ${markerToParis.toFixed(1)} km`,
    ).toBeGreaterThan(500);

    // ── 1c: /geo/nearby from Niamey — pinger appears with Niamey coords ──────
    // getNearby selects latitude/longitude (the public, city-coarse columns),
    // NOT proximity_lat/lon. So even after a Paris ping, pinger is visible
    // near Niamey and their returned coords are the city-coarse values.
    const nearbyRes = await request.get(
      `${BASE_URL}/api/geo/nearby` +
        `?lat=${NIAMEY_CENTROID.lat}&lon=${NIAMEY_CENTROID.lon}&radius=50&limit=100`,
      { headers: authHdr(observerTokens.accessToken) },
    );
    expect(nearbyRes.status()).toBe(200);
    const nearbyUsers = (await nearbyRes.json()) as Array<{
      id: string;
      latitude: number;
      longitude: number;
    }>;

    // Pinger's public pin is within 10 km of Niamey centroid; radius=50 km → must appear
    const pingerInNearby = nearbyUsers.find((u) => u.id === pinger.id);
    expect(
      pingerInNearby,
      `pinger must appear in /geo/nearby from Niamey (their public pin is < ${JITTER_SAFE_KM} km away)`,
    ).toBeDefined();

    // Returned coordinates must be near Niamey, NOT near the Paris ping GPS
    const nearbyToNiamey = haversineKm(
      pingerInNearby!.latitude, pingerInNearby!.longitude,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    const nearbyToParis = haversineKm(
      pingerInNearby!.latitude, pingerInNearby!.longitude,
      PARIS_GPS.lat, PARIS_GPS.lon,
    );
    expect(
      nearbyToNiamey,
      `/geo/nearby must return pinger's city-coarse coords near Niamey (within ${JITTER_SAFE_KM} km); got ${nearbyToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);
    expect(
      nearbyToParis,
      `/geo/nearby must NOT return pinger near the Paris GPS ping (>> 500 km); got ${nearbyToParis.toFixed(1)} km`,
    ).toBeGreaterThan(500);
  });

  /**
   * POSITIVE test — the matching algorithm still works after the fix.
   * User B's live proximity position is seeded via DB (simulates a prior successful
   * ping). User A then pings at the same spot; B must appear in A's matches.
   */
  test('1d: positive — two users at Niamey match each other via proximity ping', async ({
    request,
  }) => {
    // ── Setup: userA (pinger) + userB (candidate), both at Niamey ────────────
    const { user: userA, tokens: tokensA } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    const { user: userB } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });

    // Both must satisfy the candidate-query filter: opted in + identity-eligible.
    verifyEmailInDb(userA.id);
    verifyEmailInDb(userB.id);
    enableProximityAlerts(userA.id);
    enableProximityAlerts(userB.id);
    makeProximityEligible(userA.id);
    makeProximityEligible(userB.id);
    // Use 1 000 m radius — generous enough to absorb the zero-distance seed
    setProximityRadius(userA.id, 1000);
    setProximityRadius(userB.id, 1000);

    // Seed B's live position at Niamey centroid with a fresh timestamp (< 5 min).
    // This simulates B having already called ping themselves.
    seedProximityCoords(userB.id, NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon);

    // ── A pings at Niamey centroid — B is within 1 km and should match ───────
    const pingRes = await request.post(`${BASE_URL}/api/geo/proximity/ping`, {
      data: { lat: NIAMEY_CENTROID.lat, lon: NIAMEY_CENTROID.lon },
      headers: authHdr(tokensA.accessToken),
    });
    expect(
      pingRes.status(),
      `POST /api/geo/proximity/ping → expected 200, got ${pingRes.status()}: ${await pingRes.text()}`,
    ).toBe(200);

    const pingBody = (await pingRes.json()) as {
      matches: Array<{ userId: string; distance: number }>;
    };
    expect(Array.isArray(pingBody.matches), 'ping response must include a matches array').toBe(true);

    // B must be in A's matches
    const matchForB = pingBody.matches.find((m) => m.userId === userB.id);
    expect(
      matchForB,
      `user B (${userB.id}) must appear in user A's proximity matches when both are at Niamey centroid`,
    ).toBeDefined();

    // Distance must be a valid coarse bucket: 50, 100, 500, or 1 000 m
    expect(
      [50, 100, 500, 1000],
      `match.distance (${matchForB!.distance}) must be one of the coarse distance buckets`,
    ).toContain(matchForB!.distance);
  });

  /**
   * New eligibility gate (replaces the old map/privacy gate): a user who is NOT
   * identity-verified (no approved doc / no adult DOB) must receive empty matches
   * — even with proximity opted in. Privacy_level is now irrelevant to proximity.
   */
  test('1e: a non-identity-verified user receives empty matches (18+ gate)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);
    enableProximityAlerts(user.id);
    // Deliberately NOT calling makeProximityEligible — identity stays unverified.
    // privacy_level='private' must NOT matter anymore (decoupled from the map).
    psql(`UPDATE users SET privacy_level = 'private' WHERE id = '${user.id}';`);

    const pingRes = await request.post(`${BASE_URL}/api/geo/proximity/ping`, {
      data: { lat: NIAMEY_CENTROID.lat, lon: NIAMEY_CENTROID.lon },
      headers: authHdr(tokens.accessToken),
    });
    expect(pingRes.status()).toBe(200);
    const pingBody = (await pingRes.json()) as { matches: unknown[] };
    expect(
      pingBody.matches,
      'an unverified user is not proximity-eligible → empty matches',
    ).toHaveLength(0);
  });

  /**
   * Proximity is decoupled from the map: a show_on_map=false (map-hidden) but
   * identity-eligible user DOES participate — their live GPS is written to the
   * PRIVATE proximity_lat/lon columns (so they can be crossed), while their
   * PUBLIC latitude/longitude stays at city-coarse (never leaked to the map).
   */
  test('1f: a map-hidden but eligible user participates — GPS goes to private cols only', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);
    enableProximityAlerts(user.id);
    makeProximityEligible(user.id);
    // Deliberately do NOT call enableShowOnMap — show_on_map stays false.

    const beforeRow = getGeoRow(user.id);
    expect(beforeRow!.proximity_lat, 'proximity_lat must be null before any ping').toBeNull();

    const pingRes = await request.post(`${BASE_URL}/api/geo/proximity/ping`, {
      data: { lat: PARIS_GPS.lat, lon: PARIS_GPS.lon },
      headers: authHdr(tokens.accessToken),
    });
    expect(pingRes.status()).toBe(200);
    const pingBody = (await pingRes.json()) as { matches: unknown[] };
    // No candidate near Paris → empty, but the pinger still participates.
    expect(pingBody.matches, 'no candidate near Paris → empty matches').toHaveLength(0);

    // Live GPS IS now written to the PRIVATE columns (map gate removed).
    const afterRow = getGeoRow(user.id);
    expect(afterRow!.proximity_lat, 'proximity_lat must be written for an eligible pinger').not.toBeNull();
    const proxDistToParis = haversineKm(
      afterRow!.proximity_lat!, afterRow!.proximity_lon!,
      PARIS_GPS.lat, PARIS_GPS.lon,
    );
    expect(proxDistToParis, 'private proximity coords must equal the Paris ping GPS').toBeLessThan(1);

    // PUBLIC latitude/longitude must stay city-coarse (near Niamey) — never the live GPS.
    expect(afterRow!.latitude).toBe(beforeRow!.latitude);
    expect(afterRow!.longitude).toBe(beforeRow!.longitude);
    const pubDistToNiamey = haversineKm(
      afterRow!.latitude!, afterRow!.longitude!,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    expect(pubDistToNiamey, 'public coords must stay near Niamey, never leak Paris GPS').toBeLessThan(JITTER_SAFE_KM);
  });

  /**
   * Double-blind anti-leak: when two eligible users cross, the pinger's matches
   * carry ONLY an opaque encounterId + coarse distance — never the peer's
   * userId/name/avatar. The peer is resolvable only after an accepted request.
   */
  test('1g: a crossing match is anonymous — only {encounterId, distance}, no peer identity', async ({
    request,
  }) => {
    const { user: userA, tokens: tokensA } = await register(request, { city: 'Niamey', countryCode: 'NE' });
    const { user: userB } = await register(request, { city: 'Niamey', countryCode: 'NE' });
    verifyEmailInDb(userA.id);
    verifyEmailInDb(userB.id);
    enableProximityAlerts(userA.id);
    enableProximityAlerts(userB.id);
    makeProximityEligible(userA.id);
    makeProximityEligible(userB.id);
    setProximityRadius(userA.id, 1000);
    seedProximityCoords(userB.id, NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon);

    const pingRes = await request.post(`${BASE_URL}/api/geo/proximity/ping`, {
      data: { lat: NIAMEY_CENTROID.lat, lon: NIAMEY_CENTROID.lon },
      headers: authHdr(tokensA.accessToken),
    });
    expect(pingRes.status()).toBe(200);
    const pingBody = (await pingRes.json()) as { matches: Array<Record<string, unknown>> };
    expect(pingBody.matches.length, 'B must be crossed').toBeGreaterThanOrEqual(1);

    const m = pingBody.matches[0]!;
    // Only the opaque handle + coarse bucket — nothing that identifies B.
    expect(typeof m['encounterId'], 'match must carry an opaque encounterId').toBe('string');
    expect([50, 100, 500, 1000]).toContain(m['distance']);
    expect(m['userId'], 'match must NOT carry the peer userId').toBeUndefined();
    expect(m['name'], 'match must NOT carry the peer name').toBeUndefined();
    expect(m['avatarUrl'], 'match must NOT carry the peer avatar').toBeUndefined();
    // The peer id must not appear anywhere in the serialized match.
    expect(JSON.stringify(m)).not.toContain(userB.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG2: showOnMap is OFF by default for all new registrations
// ─────────────────────────────────────────────────────────────────────────────

test.describe('BUG2 (MEDIUM): showOnMap is OFF by default for new registrations', () => {

  /**
   * The register endpoint response must include showOnMap=false.
   * The DB must persist it as false — not a serializer artifact.
   */
  test('2a: register response and DB both show showOnMap=false', async ({ request }) => {
    const { user } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });

    expect(
      user['showOnMap'],
      'register response must include showOnMap=false for a newly created user',
    ).toBe(false);

    expect(
      getShowOnMapFromDb(user.id),
      'DB show_on_map column must be false after registration',
    ).toBe(false);
  });

  /**
   * GET /api/auth/me must confirm showOnMap=false for a fresh user,
   * regardless of whether the register response was checked.
   */
  test('2b: GET /api/auth/me confirms showOnMap=false after register', async ({ request }) => {
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);

    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: authHdr(tokens.accessToken),
    });
    expect(meRes.status()).toBe(200);
    const meBody = (await meRes.json()) as { user: Record<string, unknown> };
    expect(
      meBody.user['showOnMap'],
      'GET /api/auth/me must report showOnMap=false for a fresh user',
    ).toBe(false);
  });

  /**
   * Full lifecycle:
   *   1. Fresh user (email verified, has city coords) is NOT in individual markers.
   *   2. After PATCH showOnMap=true (+ geo cache flush), the user IS in markers.
   *
   * The geo cache is keyed per viewer; it is explicitly flushed between the two
   * queries so the second read goes to the DB instead of serving a stale cache.
   */
  test('2c: user absent from individual map pins before opting in; present after PATCH showOnMap=true', async ({
    request,
  }) => {
    // ── Target user: Niamey, email verified, showOnMap=false (default) ────────
    const { user: target, tokens: targetTokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(target.id); // emailVerified=true satisfies the individuals() filter

    // ── Observer: different user (individuals() excludes the viewer themselves) ─
    const { user: observer, tokens: observerTokens } = await register(request, {
      city: 'Paris', countryCode: 'FR',
    });
    verifyEmailInDb(observer.id);

    // ── Before opt-in: target must NOT appear in Niger bbox individual markers ─
    const niameyUrl =
      `${BASE_URL}/api/geo/members` +
      `?north=${NIGER_BBOX.north}&south=${NIGER_BBOX.south}` +
      `&east=${NIGER_BBOX.east}&west=${NIGER_BBOX.west}&zoom=12&type=people`;

    const beforeRes = await request.get(niameyUrl, {
      headers: authHdr(observerTokens.accessToken),
    });
    expect(beforeRes.status()).toBe(200);
    const beforeMarkers = (await beforeRes.json()) as Array<{
      kind: string; userId?: string;
    }>;
    expect(
      beforeMarkers.find((m) => m.kind === 'individual' && m.userId === target.id),
      `user with showOnMap=false must NOT appear as an individual map pin (targets the pre-opt-in state)`,
    ).toBeUndefined();

    // ── Target opts in via PATCH profile ─────────────────────────────────────
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { showOnMap: true },
      headers: authHdr(targetTokens.accessToken),
    });
    expect(
      patchRes.status(),
      `PATCH /api/profile/me → expected 200, got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(200);
    const patchBody = (await patchRes.json()) as { user: Record<string, unknown> };
    expect(
      patchBody.user['showOnMap'],
      'PATCH response must confirm showOnMap=true',
    ).toBe(true);

    // ── Flush the geo marker cache for this observer+bbox combination ─────────
    // The cache key mirrors the server's formula:
    //   `geo:${viewerId}:${zoom}:${type}:${north.toFixed(2)}:...`
    const cacheKey = [
      'geo',
      observer.id,
      12,
      'people',
      NIGER_BBOX.north.toFixed(2),
      NIGER_BBOX.south.toFixed(2),
      NIGER_BBOX.east.toFixed(2),
      NIGER_BBOX.west.toFixed(2),
    ].join(':');
    redisDel(cacheKey);

    // ── After opt-in: target MUST appear in Niger bbox individual markers ─────
    const afterRes = await request.get(niameyUrl, {
      headers: authHdr(observerTokens.accessToken),
    });
    expect(afterRes.status()).toBe(200);
    const afterMarkers = (await afterRes.json()) as Array<{
      kind: string; userId?: string; lat: number; lon: number;
    }>;

    const targetMarker = afterMarkers.find(
      (m) => m.kind === 'individual' && m.userId === target.id,
    );
    expect(
      targetMarker,
      `user must appear as individual map pin after setting showOnMap=true`,
    ).toBeDefined();

    // Sanity-check the marker's coordinates are near Niamey
    const distToNiamey = haversineKm(
      targetMarker!.lat, targetMarker!.lon,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    expect(
      distToNiamey,
      `individual marker must be near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${distToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG3: PATCH /api/profile/me must never store raw client GPS verbatim
// ─────────────────────────────────────────────────────────────────────────────

test.describe('BUG3 (LOW): PATCH /api/profile/me must never store raw client GPS verbatim', () => {

  /**
   * When the client sends coordinates that are within 150 km of the city
   * centroid, the service must apply jitterCoord() before storing. The stored
   * value must differ from the exact input by at least 1 micro-degree (the
   * probability of zero jitter is astronomically small), yet remain within
   * JITTER_SAFE_KM of Niamey centroid.
   */
  test('3a: coords within city radius → stored with jitter (not exact input)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);

    // Send the exact hardcoded Niamey centroid value as client coords
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: {
        city: 'Niamey',
        countryCode: 'NE',
        latitude: NIAMEY_CENTROID.lat,
        longitude: NIAMEY_CENTROID.lon,
      },
      headers: authHdr(tokens.accessToken),
    });
    expect(
      patchRes.status(),
      `PATCH → expected 200, got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(200);

    const body = (await patchRes.json()) as { user: Record<string, unknown> };
    const storedLat = Number(body.user['latitude']);
    const storedLon = Number(body.user['longitude']);

    expect(Number.isFinite(storedLat), 'stored latitude must not be null/NaN').toBe(true);
    expect(Number.isFinite(storedLon), 'stored longitude must not be null/NaN').toBe(true);

    // At least one axis must differ from the exact input (jitter was applied).
    // COORD_JITTER_DEGREES = 0.04; probability of zero offset on BOTH axes is ~(1/2^53)^2 ≈ 0.
    const latDiff = Math.abs(storedLat - NIAMEY_CENTROID.lat);
    const lonDiff = Math.abs(storedLon - NIAMEY_CENTROID.lon);
    expect(
      latDiff > 1e-6 || lonDiff > 1e-6,
      `Stored coords (${storedLat}, ${storedLon}) must differ from raw input (${NIAMEY_CENTROID.lat}, ${NIAMEY_CENTROID.lon}) by jitter — at least one axis must shift`,
    ).toBe(true);

    // But the result must still be near Niamey (jitter is ±0.02° ≈ 2.2 km)
    const distToNiamey = haversineKm(
      storedLat, storedLon,
      NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon,
    );
    expect(
      distToNiamey,
      `Jittered coords must stay near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${distToNiamey.toFixed(3)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);
  });

  /**
   * When the client claims city=Niamey but sends coordinates that are > 150 km
   * from the Niamey centroid (here London at ~4 600 km), the service must
   * reject the client coords and fall back to server-geocoded centroid+jitter.
   * The stored value must be near Niamey, NOT near London.
   */
  test('3b: coords > 150 km from city centroid → server-geocoded centroid replaces client GPS', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);

    // London GPS is ~4 600 km from Niamey — far beyond MAX_CLIENT_COORD_DISTANCE_KM (150 km)
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: {
        city: 'Niamey',
        countryCode: 'NE',
        latitude: LONDON_GPS.lat,
        longitude: LONDON_GPS.lon,
      },
      headers: authHdr(tokens.accessToken),
    });
    expect(
      patchRes.status(),
      `PATCH → expected 200 (fallback, not rejection), got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(200);

    const body = (await patchRes.json()) as { user: Record<string, unknown> };
    const storedLat = Number(body.user['latitude']);
    const storedLon = Number(body.user['longitude']);

    expect(Number.isFinite(storedLat), 'stored latitude must not be null/NaN after fallback').toBe(true);
    expect(Number.isFinite(storedLon), 'stored longitude must not be null/NaN after fallback').toBe(true);

    // Must NOT be anywhere near London
    const distToLondon = haversineKm(storedLat, storedLon, LONDON_GPS.lat, LONDON_GPS.lon);
    expect(
      distToLondon,
      `Stored coords must NOT be near London GPS (expected >> 1 000 km); got ${distToLondon.toFixed(1)} km`,
    ).toBeGreaterThan(1000); // Niamey→London ≈ 4 600 km

    // Must be near Niamey (server-geocoded centroid + jitter)
    const distToNiamey = haversineKm(storedLat, storedLon, NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon);
    expect(
      distToNiamey,
      `Fallback coords must be near Niamey centroid (within ${JITTER_SAFE_KM} km); got ${distToNiamey.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);
  });

  /**
   * When city/countryCode change without any explicit latitude/longitude,
   * the server must re-geocode the new city and jitter — not copy the old pin
   * and not trust any client GPS. The resulting coords must follow the new city.
   */
  test('3c: city change without explicit coords → pin re-geocoded from new city (not client GPS)', async ({
    request,
  }) => {
    // Start in Niamey
    const { user, tokens } = await register(request, {
      city: 'Niamey', countryCode: 'NE',
    });
    verifyEmailInDb(user.id);

    // Move to Paris without sending any coordinate values
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { city: 'Paris', countryCode: 'FR' },
      headers: authHdr(tokens.accessToken),
    });
    expect(patchRes.status()).toBe(200);

    const body = (await patchRes.json()) as { user: Record<string, unknown> };
    const storedLat = Number(body.user['latitude']);
    const storedLon = Number(body.user['longitude']);

    expect(Number.isFinite(storedLat), 're-geocoded latitude must not be null/NaN').toBe(true);
    expect(Number.isFinite(storedLon), 're-geocoded longitude must not be null/NaN').toBe(true);

    // Pin must now be near Paris (from the CITY_COORDS table: 48.8566°N, 2.3522°E)
    const PARIS_CENTROID = { lat: 48.8566, lon: 2.3522 } as const;
    const distToParis = haversineKm(storedLat, storedLon, PARIS_CENTROID.lat, PARIS_CENTROID.lon);
    expect(
      distToParis,
      `Re-geocoded pin from city=Paris must be near Paris centroid (within ${JITTER_SAFE_KM} km); got ${distToParis.toFixed(2)} km`,
    ).toBeLessThan(JITTER_SAFE_KM);

    // Must NOT be near old city (Niamey is ~4 900 km from Paris)
    const distToNiamey = haversineKm(storedLat, storedLon, NIAMEY_CENTROID.lat, NIAMEY_CENTROID.lon);
    expect(
      distToNiamey,
      `Re-geocoded pin must NOT be near old city Niamey; got ${distToNiamey.toFixed(1)} km`,
    ).toBeGreaterThan(500);
  });
});
