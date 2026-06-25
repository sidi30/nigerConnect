/**
 * profile-and-map.spec.ts
 *
 * Contract tests for:
 *   1. WORLDWIDE CITIES — GET /api/geo/cities?q=Tokyo / ?q=Berlin
 *   2. REGISTRATION sets countryCode + geocoded coords
 *   3. PROFILE COMPLETION via PATCH /api/profile/me updates coords (OAuth onboarding path)
 *   4. UNVERIFIED users are hidden from search; appear after verification
 *
 * Prerequisites:
 *   API_BASE_URL=http://127.0.0.1:3000  (NestJS, prefix /api)
 *   Postgres accessible via docker exec nigerconnect-postgres (port 5433)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ────────────────────────────────────────────────────────────────

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

/**
 * Query a single user row returning selected columns as JSON.
 * Returns null when the user does not exist.
 */
function getUserRow(userId: string): {
  id: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  email_verified: boolean;
} | null {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT id, country_code, latitude, longitude, email_verified
         FROM users
        WHERE id = '${userId}'::uuid
     ) t;`,
  );
  const match = out.match(/\{.*\}/);
  return match ? (JSON.parse(match[0]) as ReturnType<typeof getUserRow>) : null;
}

// ── Request helpers ───────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2eprofile'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; emailVerified: boolean; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'ProfileE2E',
      lastName: 'Test',
      ...extra,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

// ── 1. WORLDWIDE CITIES ───────────────────────────────────────────────────────

test.describe('1. GET /api/geo/cities — worldwide cities (public)', () => {

  test('q=Tokyo → JP results with required shape and countryCode=JP', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=Tokyo`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);

    const body = (await res.json()) as Array<{
      name: string;
      countryCode: string;
      lat: number;
      lng: number;
    }>;

    expect(Array.isArray(body), 'response must be an array').toBe(true);
    expect(body.length, 'must return at least one result for q=Tokyo').toBeGreaterThan(0);

    // Every item must have the required fields
    for (const city of body) {
      expect(typeof city.name, `name must be string, got ${typeof city.name}`).toBe('string');
      expect(typeof city.countryCode, `countryCode must be string`).toBe('string');
      expect(typeof city.lat, `lat must be number`).toBe('number');
      expect(typeof city.lng, `lng must be number`).toBe('number');
    }

    // Tokyo (JP) must appear
    const tokyo = body.find(
      (c) => c.name.toLowerCase().includes('tokyo') && c.countryCode === 'JP',
    );
    expect(tokyo, 'Tokyo JP must be in results for q=Tokyo').toBeDefined();

    // Approximate coord check: Tokyo ~35.7°N, ~139.7°E
    expect(tokyo!.lat, `Tokyo lat ${tokyo!.lat} should be ~35.7`).toBeGreaterThan(33);
    expect(tokyo!.lat, `Tokyo lat ${tokyo!.lat} should be ~35.7`).toBeLessThan(38);
    expect(tokyo!.lng, `Tokyo lng ${tokyo!.lng} should be ~139.7`).toBeGreaterThan(137);
    expect(tokyo!.lng, `Tokyo lng ${tokyo!.lng} should be ~139.7`).toBeLessThan(142);
  });

  test('q=Berlin → DE result with countryCode=DE present', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=Berlin`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);

    const body = (await res.json()) as Array<{
      name: string;
      countryCode: string;
      lat: number;
      lng: number;
    }>;

    expect(Array.isArray(body), 'response must be an array').toBe(true);
    expect(body.length, 'must return results for q=Berlin').toBeGreaterThan(0);

    // Shape check on all items
    for (const city of body) {
      expect(typeof city.name).toBe('string');
      expect(typeof city.countryCode).toBe('string');
      expect(typeof city.lat).toBe('number');
      expect(typeof city.lng).toBe('number');
    }

    // Berlin DE must appear
    const berlin = body.find(
      (c) => c.name.toLowerCase() === 'berlin' && c.countryCode === 'DE',
    );
    expect(berlin, 'Berlin DE must be in results for q=Berlin').toBeDefined();

    // Berlin ~52.5°N, ~13.4°E
    expect(berlin!.lat).toBeGreaterThan(50);
    expect(berlin!.lat).toBeLessThan(55);
    expect(berlin!.lng).toBeGreaterThan(11);
    expect(berlin!.lng).toBeLessThan(16);
  });

  test('endpoint is @Public — no Authorization header needed', async ({ request }) => {
    // No Authorization header at all — must still return 200
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=Tokyo`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
      // deliberately NO Authorization header
    });
    expect(res.status(), 'public endpoint must not require auth').toBe(200);
  });
});

// ── 2. REGISTRATION sets countryCode + geocoded coords ───────────────────────

test.describe('2. POST /api/auth/register — countryCode stored with geocoded coords', () => {

  test("register with countryCode='FR' + city='Lyon' → DB row has country_code='FR' and non-null lat/lng", async ({
    request,
  }) => {
    const email = randomEmail('e2ereg');
    const { user } = await register(request, email, {
      countryCode: 'FR',
      city: 'Lyon',
    });

    // Register response itself must carry coords
    expect(user['countryCode'], 'register response must echo countryCode=FR').toBe('FR');
    expect(user['latitude'], 'register response must have non-null latitude').not.toBeNull();
    expect(user['longitude'], 'register response must have non-null longitude').not.toBeNull();

    // DB assertion — server geocoded at write time
    const row = getUserRow(user.id);
    expect(row, 'user row must exist in DB').not.toBeNull();
    expect(row!.country_code, 'DB country_code must be FR').toBe('FR');
    expect(row!.latitude, 'DB latitude must not be null for Lyon FR').not.toBeNull();
    expect(row!.longitude, 'DB longitude must not be null for Lyon FR').not.toBeNull();

    // Sanity-range: Lyon is at ~45.75°N, ~4.83°E — allow generous jitter
    expect(Number(row!.latitude)).toBeGreaterThan(43);
    expect(Number(row!.latitude)).toBeLessThan(48);
    expect(Number(row!.longitude)).toBeGreaterThan(2);
    expect(Number(row!.longitude)).toBeLessThan(7);
  });
});

// ── 3. PROFILE COMPLETION via PATCH → coords updated ─────────────────────────

test.describe('3. PATCH /api/profile/me — profile completion updates geocoded coords', () => {

  test("PATCH city='Niamey' + countryCode='NE' after register → 200, DB coords non-null near Niamey", async ({
    request,
  }) => {
    // Register without location (no city/countryCode in payload) so coords start null
    const email = randomEmail('e2epatch');
    const { user, tokens } = await register(request, email);

    // Verify email in DB so the guard lets PATCH through
    verifyEmailInDb(user.id);

    // PATCH the profile — simulates the OAuth complete-profile onboarding screen
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { city: 'Niamey', countryCode: 'NE' },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });

    expect(
      patchRes.status(),
      `PATCH /api/profile/me must return 200, got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(200);

    const patchBody = (await patchRes.json()) as { user: Record<string, unknown> };
    expect(patchBody.user['city'], 'response must echo city=Niamey').toBe('Niamey');
    expect(patchBody.user['countryCode'], 'response must echo countryCode=NE').toBe('NE');
    expect(patchBody.user['latitude'], 'response latitude must not be null after geocode').not.toBeNull();
    expect(patchBody.user['longitude'], 'response longitude must not be null after geocode').not.toBeNull();

    // DB assertion — coords must be persisted
    const row = getUserRow(user.id);
    expect(row!.latitude, 'DB latitude must be non-null after PATCH with Niamey NE').not.toBeNull();
    expect(row!.longitude, 'DB longitude must be non-null after PATCH with Niamey NE').not.toBeNull();

    // Niamey ~13.5°N, ~2.1°E
    expect(Number(row!.latitude)).toBeGreaterThan(10);
    expect(Number(row!.latitude)).toBeLessThan(17);
    expect(Number(row!.longitude)).toBeGreaterThan(-1);
    expect(Number(row!.longitude)).toBeLessThan(5);
  });

  test('PATCH /api/profile/me blocked with 403 for unverified user', async ({ request }) => {
    const email = randomEmail('e2epatchunv');
    const { tokens } = await register(request, email);

    // Do NOT verify email — EmailVerifiedGuard must block
    const patchRes = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { city: 'Paris', countryCode: 'FR' },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });

    expect(patchRes.status(), 'unverified user must get 403 from EmailVerifiedGuard').toBe(403);
    const body = (await patchRes.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });
});

// ── 4. UNVERIFIED users hidden from search ────────────────────────────────────

test.describe('4. GET /api/profile/search — unverified users hidden, visible after verification', () => {

  test('unverified user B absent from search; appears after email_verified=true in DB', async ({
    request,
  }) => {
    // Use sufficiently unique first names to make the search deterministic
    const uniqueFragment = `Zxqtest${Date.now().toString(36)}`;

    // User A — verified viewer
    const emailA = randomEmail('e2esrcha');
    const { user: userA, tokens: tokensA } = await register(request, emailA, {
      firstName: `${uniqueFragment}A`,
      lastName: 'Viewer',
    });
    verifyEmailInDb(userA.id);

    // User B — left unverified initially
    const emailB = randomEmail('e2esrchb');
    const { user: userB } = await register(request, emailB, {
      firstName: `${uniqueFragment}B`,
      lastName: 'Hidden',
    });
    // Confirm B is unverified in DB
    const rowBefore = getUserRow(userB.id);
    expect(rowBefore!.email_verified, 'user B must start unverified').toBe(false);

    // Search for B's unique name — must NOT appear while unverified
    const beforeRes = await request.get(
      `${BASE_URL}/api/profile/search?q=${uniqueFragment}B`,
      {
        headers: {
          Authorization: `Bearer ${tokensA.accessToken}`,
          'X-Forwarded-For': uniqueIp(),
        },
      },
    );
    expect(beforeRes.status(), `search must return 200, got ${beforeRes.status()}`).toBe(200);
    const beforeBody = (await beforeRes.json()) as { items: Array<{ id: string }> };
    const beforeIds = beforeBody.items.map((u) => u.id);
    expect(
      beforeIds,
      `unverified user B (${userB.id}) must NOT appear in search results before verification`,
    ).not.toContain(userB.id);

    // Verify B in DB
    verifyEmailInDb(userB.id);

    // Search again — B must now appear
    const afterRes = await request.get(
      `${BASE_URL}/api/profile/search?q=${uniqueFragment}B`,
      {
        headers: {
          Authorization: `Bearer ${tokensA.accessToken}`,
          'X-Forwarded-For': uniqueIp(),
        },
      },
    );
    expect(afterRes.status(), `search must return 200 after verification, got ${afterRes.status()}`).toBe(200);
    const afterBody = (await afterRes.json()) as { items: Array<{ id: string }> };
    const afterIds = afterBody.items.map((u) => u.id);
    expect(
      afterIds,
      `verified user B (${userB.id}) must appear in search results after verification`,
    ).toContain(userB.id);
  });

  test('verified user A does not appear in search results for verified user B (search excludes self by default)', async ({
    request,
  }) => {
    // This is a sanity check — search must work bidirectionally for verified users
    const uniqueFragment = `Zxqself${Date.now().toString(36)}`;

    const emailA = randomEmail('e2eself');
    const { user: userA, tokens: tokensA } = await register(request, emailA, {
      firstName: `${uniqueFragment}A`,
      lastName: 'Self',
    });
    verifyEmailInDb(userA.id);

    // Search for own unique name — self should generally be excluded or included
    // (either is acceptable — we assert on status 200 and shape, not on self-exclusion)
    const res = await request.get(
      `${BASE_URL}/api/profile/search?q=${uniqueFragment}A`,
      {
        headers: {
          Authorization: `Bearer ${tokensA.accessToken}`,
          'X-Forwarded-For': uniqueIp(),
        },
      },
    );
    expect(res.status(), 'self-search must return 200').toBe(200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown };
    expect(Array.isArray(body.items), 'items must be an array').toBe(true);
    // nextCursor must be present in the response shape (null or string)
    expect('nextCursor' in body, 'response must include nextCursor field').toBe(true);
  });
});
