/**
 * city-required-map.spec.ts
 *
 * Regression guard for the bug fix: creating a page/association without a
 * city/countryCode made it invisible on the map forever.
 *
 * Covered:
 *   1. POST /api/associations WITHOUT city/countryCode → 400 (Zod validation).
 *   2. POST /api/associations WITH city="Niamey" countryCode="NE" → 201, then
 *      GET /api/geo/members?...bounds covering Niger → association marker present
 *      (kind='association', matching id and name).
 *   3. POST /api/pages WITHOUT city/countryCode → 400 (Zod validation).
 *   4. POST /api/pages WITH city="Niamey" countryCode="NE" → 201, then
 *      GET /api/geo/members?...bounds covering Niger → page marker present
 *      (kind='page', matching id and name).
 *
 * Prerequisites:
 *   API running on API_BASE_URL (default http://127.0.0.1:3000)
 *   Postgres accessible via docker exec nigerconnect-postgres
 *
 * Conventions matched from features-contract.spec.ts and register-location.spec.ts:
 *   - BASE_URL from env API_BASE_URL
 *   - VALID_PASSWORD shared constant
 *   - PSQL_CMD helper for DB mutations
 *   - uniqueIp() per-request rate-limit bypass
 *   - randomEmail() for isolation
 *   - register() / verifyEmailInDb() / approveIdentityInDb() / registerApproved()
 *   - authHeaders() helper
 */

import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// Niger bounding box — generous enough to contain Niamey (~13.5°N, ~2.1°E).
// Using type=associations surfaces both association AND page markers per geo.service.ts.
const NIGER_NORTH = 24;
const NIGER_SOUTH = 11;
const NIGER_EAST = 16;
const NIGER_WEST = 0;

// ── DB helpers ────────────────────────────────────────────────────────────────

const PSQL_CMD = (sql: string) =>
  `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${sql.replace(/"/g, '\\"')}"`;

function verifyEmailInDb(userId: string): void {
  execSync(
    PSQL_CMD(`UPDATE users SET email_verified = true WHERE id = '${userId}';`),
    { stdio: 'pipe' },
  );
}

function approveIdentityInDb(userId: string): void {
  execSync(
    PSQL_CMD(`UPDATE users SET identity_status = 'approved' WHERE id = '${userId}';`),
    { stdio: 'pipe' },
  );
}

// ── Request helpers ───────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2ecityrequired+${ts}${rand}@nigerconnect.test`;
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
  email: string,
): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'CityE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

/** Register + verify email + approve identity, then re-login for a fresh token. */
async function registerApproved(request: APIRequestContext) {
  const email = randomEmail();
  const { user, tokens } = await register(request, email);
  verifyEmailInDb(user.id);
  approveIdentityInDb(user.id);
  // Re-login so the JWT reflects the updated DB state.
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(loginRes.status()).toBe(200);
  const loginBody = (await loginRes.json()) as AuthResponse;
  return { user, tokens: loginBody.tokens };
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

// ── 1 & 2. ASSOCIATIONS ───────────────────────────────────────────────────────

test.describe('POST /api/associations — city/countryCode required', () => {

  test('POST without city/countryCode → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `AssocMissingCity-${Date.now()}`,
        category: 'generaliste',
        // city and countryCode intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when city+countryCode missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST without countryCode only → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `AssocMissingCC-${Date.now()}`,
        category: 'generaliste',
        city: 'Niamey',
        // countryCode intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when countryCode missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST without city only → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `AssocMissingCity2-${Date.now()}`,
        category: 'generaliste',
        countryCode: 'NE',
        // city intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when city missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST with city="Niamey" countryCode="NE" → 201 + marker appears in Niger bbox', async ({ request }) => {
    const { tokens } = await registerApproved(request);
    const assocName = `AssocNiamey-${Date.now()}`;

    // Create the association — must succeed with 201
    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: assocName,
        category: 'generaliste',
        city: 'Niamey',
        countryCode: 'NE',
      },
      headers: authHeaders(tokens.accessToken),
    });
    expect(
      createRes.status(),
      `create association: expected 201, got ${createRes.status()}: ${await createRes.text()}`,
    ).toBe(201);

    const created = (await createRes.json()) as { id: string; name: string; city: string; countryCode: string };
    expect(typeof created.id, 'created.id must be a string').toBe('string');
    expect(created.city, 'response must echo city=Niamey').toBe('Niamey');
    expect(created.countryCode, 'response must echo countryCode=NE').toBe('NE');

    // Verify the association appears on the map within a Niger bounding box.
    // type=associations surfaces both association and page markers (per geo.service.ts).
    // zoom >= 9 is not required for orgs — they are always returned when includeAssocs=true.
    const markersRes = await request.get(
      `${BASE_URL}/api/geo/members?north=${NIGER_NORTH}&south=${NIGER_SOUTH}&east=${NIGER_EAST}&west=${NIGER_WEST}&zoom=5&type=associations`,
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'X-Forwarded-For': uniqueIp(),
        },
      },
    );
    expect(
      markersRes.status(),
      `geo/members: expected 200, got ${markersRes.status()}: ${await markersRes.text()}`,
    ).toBe(200);

    const markers = (await markersRes.json()) as Array<{
      kind: string;
      associationId?: string;
      name?: string;
      lat: number;
      lon: number;
    }>;
    expect(Array.isArray(markers), 'geo/members must return an array').toBe(true);

    // The newly created association must appear as an 'association' marker
    const myMarker = markers.find(
      (m) => m.kind === 'association' && m.associationId === created.id,
    );
    expect(
      myMarker,
      `association ${created.id} (${assocName}) must appear as kind='association' marker in Niger bbox. Markers: ${JSON.stringify(markers.filter((m) => m.kind === 'association').slice(0, 5))}`,
    ).toBeDefined();

    // Sanity-check the marker's name and coordinates
    expect(myMarker!.name, 'marker name must match association name').toBe(assocName);

    // Niamey is ~13.5°N, ~2.1°E — within our Niger bbox
    expect(myMarker!.lat, `lat ${myMarker!.lat} must be > 11 (Niger south border)`).toBeGreaterThan(11);
    expect(myMarker!.lat, `lat ${myMarker!.lat} must be < 24 (Niger north border)`).toBeLessThan(24);
    expect(myMarker!.lon, `lon ${myMarker!.lon} must be > 0 (Niger west border)`).toBeGreaterThan(0);
    expect(myMarker!.lon, `lon ${myMarker!.lon} must be < 16 (Niger east border)`).toBeLessThan(16);
  });
});

// ── 3 & 4. PAGES ─────────────────────────────────────────────────────────────

test.describe('POST /api/pages — city/countryCode required', () => {

  test('POST without city/countryCode → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        name: `PageMissingCity-${Date.now()}`,
        kind: 'community',
        // city and countryCode intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when city+countryCode missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST without countryCode only → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        name: `PageMissingCC-${Date.now()}`,
        kind: 'community',
        city: 'Niamey',
        // countryCode intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when countryCode missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST without city only → 400 (Zod validation)', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        name: `PageMissingCity2-${Date.now()}`,
        kind: 'community',
        countryCode: 'NE',
        // city intentionally omitted
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Expected 400 when city missing, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test('POST with city="Niamey" countryCode="NE" → 201 + marker appears in Niger bbox', async ({ request }) => {
    const { tokens } = await registerApproved(request);
    const pageName = `PageNiamey-${Date.now()}`;

    // Create the page — must succeed with 201
    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        name: pageName,
        kind: 'community',
        city: 'Niamey',
        countryCode: 'NE',
      },
      headers: authHeaders(tokens.accessToken),
    });
    expect(
      createRes.status(),
      `create page: expected 201, got ${createRes.status()}: ${await createRes.text()}`,
    ).toBe(201);

    const created = (await createRes.json()) as { id: string; name: string; city: string; countryCode: string };
    expect(typeof created.id, 'created.id must be a string').toBe('string');
    expect(created.city, 'response must echo city=Niamey').toBe('Niamey');
    expect(created.countryCode, 'response must echo countryCode=NE').toBe('NE');

    // Verify the page appears on the map within a Niger bounding box.
    // type=associations surfaces both association and page markers (per geo.service.ts).
    const markersRes = await request.get(
      `${BASE_URL}/api/geo/members?north=${NIGER_NORTH}&south=${NIGER_SOUTH}&east=${NIGER_EAST}&west=${NIGER_WEST}&zoom=5&type=associations`,
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'X-Forwarded-For': uniqueIp(),
        },
      },
    );
    expect(
      markersRes.status(),
      `geo/members: expected 200, got ${markersRes.status()}: ${await markersRes.text()}`,
    ).toBe(200);

    const markers = (await markersRes.json()) as Array<{
      kind: string;
      pageId?: string;
      name?: string;
      lat: number;
      lon: number;
    }>;
    expect(Array.isArray(markers), 'geo/members must return an array').toBe(true);

    // The newly created page must appear as a 'page' marker
    const myMarker = markers.find(
      (m) => m.kind === 'page' && m.pageId === created.id,
    );
    expect(
      myMarker,
      `page ${created.id} (${pageName}) must appear as kind='page' marker in Niger bbox. Markers: ${JSON.stringify(markers.filter((m) => m.kind === 'page').slice(0, 5))}`,
    ).toBeDefined();

    // Sanity-check the marker's name and coordinates
    expect(myMarker!.name, 'marker name must match page name').toBe(pageName);

    // Niamey is ~13.5°N, ~2.1°E — within our Niger bbox
    expect(myMarker!.lat, `lat ${myMarker!.lat} must be > 11 (Niger south border)`).toBeGreaterThan(11);
    expect(myMarker!.lat, `lat ${myMarker!.lat} must be < 24 (Niger north border)`).toBeLessThan(24);
    expect(myMarker!.lon, `lon ${myMarker!.lon} must be > 0 (Niger west border)`).toBeGreaterThan(0);
    expect(myMarker!.lon, `lon ${myMarker!.lon} must be < 16 (Niger east border)`).toBeLessThan(16);
  });
});
