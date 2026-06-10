/**
 * register-location.spec.ts
 *
 * Contract tests for location-aware user registration:
 *
 *   POST /auth/register now accepts optional latitude/longitude fields.
 *   Rules:
 *     - city + countryCode only → geocoded coords stored (non-null) near the city
 *     - latitude + longitude both provided → stored (with privacy jitter, near provided point)
 *     - only latitude (no longitude) → 400 validation error (both-or-neither)
 *     - only longitude (no latitude) → 400 validation error
 *     - worldwide non-diaspora city (e.g. Tokyo JP) → geocoded coords present
 *
 *   GET /api/geo/members?...bounds (auth required) returns map markers; a user
 *   with resolved coords appears in the bounding box covering their city.
 *
 * Prerequisites: API running on API_BASE_URL (default http://localhost:3000)
 * Postgres available for email-verification DB mutations (same as other specs).
 */

import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

const PSQL_CMD = (sql: string) =>
  `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${sql.replace(/"/g, '\\"')}"`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2egeo+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email: randomEmail(),
      password: VALID_PASSWORD,
      firstName: 'GeoE2E',
      lastName: 'Test',
      ...payload,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  return { status: res.status(), body: await res.json() };
}

async function registerOk(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<AuthResponse> {
  const email = randomEmail();
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'GeoE2E',
      lastName: 'Test',
      ...payload,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

/** Mark email verified via direct DB mutation — required by EmailVerifiedGuard. */
function verifyEmailInDb(userId: string): void {
  execSync(
    PSQL_CMD(`UPDATE users SET email_verified = true WHERE id = '${userId}';`),
    { stdio: 'pipe' },
  );
}

/** Enable show_on_map so the user appears in /geo/members individual markers. */
function enableShowOnMap(userId: string): void {
  execSync(
    PSQL_CMD(`UPDATE users SET show_on_map = true WHERE id = '${userId}';`),
    { stdio: 'pipe' },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('POST /api/auth/register — location fields', () => {

  test('city + countryCode only → 201, profile has non-null lat/lng near city centroid', async ({ request }) => {
    // Register with Niamey NE — the geocoder should resolve real coords
    const { user, tokens } = await registerOk(request, {
      city: 'Niamey',
      countryCode: 'NE',
    });
    verifyEmailInDb(user.id);

    // GET /me exposes the serialized user — coords must be non-null
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json() as { user: Record<string, unknown> };

    // latitude and longitude must be present and non-null
    expect(meBody.user['latitude'], 'latitude must be non-null for Niamey NE').not.toBeNull();
    expect(meBody.user['longitude'], 'longitude must be non-null for Niamey NE').not.toBeNull();

    const lat = Number(meBody.user['latitude']);
    const lng = Number(meBody.user['longitude']);

    // Niamey is at ~13.5°N, ~2.1°E — allow a few degrees of jitter
    expect(lat, `lat ${lat} should be near 13.5`).toBeGreaterThan(10);
    expect(lat, `lat ${lat} should be near 13.5`).toBeLessThan(17);
    expect(lng, `lng ${lng} should be near 2.1`).toBeGreaterThan(-1);
    expect(lng, `lng ${lng} should be near 2.1`).toBeLessThan(5);
  });

  test('latitude + longitude both provided → 201, stored coords near supplied point', async ({ request }) => {
    // Exact Niamey coords — stored with at most ~2 km privacy jitter
    const suppliedLat = 13.5137;
    const suppliedLng = 2.1175;

    const { user, tokens } = await registerOk(request, {
      city: 'Niamey',
      countryCode: 'NE',
      latitude: suppliedLat,
      longitude: suppliedLng,
    });
    verifyEmailInDb(user.id);

    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json() as { user: Record<string, unknown> };

    const lat = Number(meBody.user['latitude']);
    const lng = Number(meBody.user['longitude']);

    // Must be within ~2° of supplied values (generous for privacy jitter)
    expect(lat).toBeGreaterThan(suppliedLat - 2);
    expect(lat).toBeLessThan(suppliedLat + 2);
    expect(lng).toBeGreaterThan(suppliedLng - 2);
    expect(lng).toBeLessThan(suppliedLng + 2);
  });

  test('only latitude provided (no longitude) → 400 validation error', async ({ request }) => {
    const { status } = await register(request, {
      city: 'Niamey',
      countryCode: 'NE',
      latitude: 13.5137,
      // longitude intentionally omitted
    });
    expect(status, 'half-pair lat-only must be rejected with 400').toBe(400);
  });

  test('only longitude provided (no latitude) → 400 validation error', async ({ request }) => {
    const { status } = await register(request, {
      city: 'Niamey',
      countryCode: 'NE',
      longitude: 2.1175,
      // latitude intentionally omitted
    });
    expect(status, 'half-pair lng-only must be rejected with 400').toBe(400);
  });

  test('worldwide non-diaspora city (Tokyo JP) → geocoded coords present', async ({ request }) => {
    const { user, tokens } = await registerOk(request, {
      city: 'Tokyo',
      countryCode: 'JP',
    });
    verifyEmailInDb(user.id);

    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(meRes.status()).toBe(200);
    const meBody = await meRes.json() as { user: Record<string, unknown> };

    // Tokyo coords must be resolved (not null) via WorldCitiesService fallback
    expect(meBody.user['latitude'], 'latitude must be non-null for Tokyo JP').not.toBeNull();
    expect(meBody.user['longitude'], 'longitude must be non-null for Tokyo JP').not.toBeNull();

    const lat = Number(meBody.user['latitude']);
    const lng = Number(meBody.user['longitude']);

    // Tokyo is at ~35.7°N, ~139.7°E
    expect(lat).toBeGreaterThan(33);
    expect(lat).toBeLessThan(38);
    expect(lng).toBeGreaterThan(137);
    expect(lng).toBeLessThan(142);
  });

  test('Paris FR with coords → geocoded, user appears in geo/members bbox', async ({ request }) => {
    const suppliedLat = 48.8566;
    const suppliedLng = 2.3522;

    const { user, tokens } = await registerOk(request, {
      city: 'Paris',
      countryCode: 'FR',
      latitude: suppliedLat,
      longitude: suppliedLng,
    });
    verifyEmailInDb(user.id);
    enableShowOnMap(user.id);

    // Bounding box around Paris (zoom >= 9 → individual markers)
    const north = 49.5;
    const south = 48.0;
    const east = 3.5;
    const west = 1.5;

    const markersRes = await request.get(
      `${BASE_URL}/api/geo/members?north=${north}&south=${south}&east=${east}&west=${west}&zoom=12&type=people`,
      {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
      },
    );
    expect(markersRes.status()).toBe(200);
    const markers = await markersRes.json() as Array<{
      kind: string;
      userId?: string;
      lat: number;
      lon: number;
    }>;
    expect(Array.isArray(markers)).toBe(true);

    // The registered user must appear as an individual marker within the bbox
    const myMarker = markers.find(
      (m) => m.kind === 'individual' && m.userId === user.id,
    );
    expect(myMarker, 'registered user must appear as individual marker in Paris bbox').toBeDefined();
  });

  test('latitude out of range (-91) → 400', async ({ request }) => {
    const { status } = await register(request, {
      latitude: -91,
      longitude: 2.1,
    });
    expect(status).toBe(400);
  });

  test('longitude out of range (181) → 400', async ({ request }) => {
    const { status } = await register(request, {
      latitude: 13.5,
      longitude: 181,
    });
    expect(status).toBe(400);
  });
});
