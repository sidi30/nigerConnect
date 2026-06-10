/**
 * geo-cities.spec.ts
 *
 * Contract tests for the worldwide city autocomplete endpoint:
 *   GET /api/geo/cities?q=<query>&country=<ISO2 optional>&limit=<n>
 *
 * The endpoint is @Public — no auth token required. It is backed by the
 * WorldCitiesService (~135k city in-memory index built from `all-the-cities`).
 *
 * Assertions:
 *   1. q >= 2 chars → returns matching cities with correct shape
 *   2. Known city (Niamey NE) → found with approximate coords
 *   3. Country filter (Tokyo JP) → narrows results to Japan
 *   4. q = "" or 1 char → empty array (DoS guard)
 *   5. limit parameter is respected
 *   6. Results are sorted by population descending
 *   7. No auth token needed (no 401)
 *
 * Prerequisites: API running on API_BASE_URL (default http://localhost:3000)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

// The endpoint is @Public — we deliberately never attach an Authorization header
// in any test to prove auth is not required.
// We do send a unique X-Forwarded-For per test (following the rest of the e2e
// suite pattern) so parallel test workers do not share a rate-limit bucket.
function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

test.describe('GET /api/geo/cities — city autocomplete', () => {

  test('@Public — no auth required, q=niam returns 200 array', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=niam`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    // Must succeed without any Authorization header
    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('q=niam → Niamey (NE) in results with correct shape and approximate coords', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=niam`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{
      name: string;
      countryCode: string;
      lat: number;
      lng: number;
      population: number;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // Each item must have the documented shape
    for (const city of body) {
      expect(typeof city.name).toBe('string');
      expect(typeof city.countryCode).toBe('string');
      expect(typeof city.lat).toBe('number');
      expect(typeof city.lng).toBe('number');
      expect(typeof city.population).toBe('number');
    }

    // Niamey is Niger's capital — must appear for query "niam"
    const niamey = body.find(
      (c) => c.name.toLowerCase().includes('niamey') && c.countryCode === 'NE',
    );
    expect(niamey, 'Niamey NE must be in results for q=niam').toBeDefined();

    // Approximate coordinate check: Niamey is at ~13.5°N, ~2.1°E
    expect(niamey!.lat, 'Niamey latitude ~13.5').toBeGreaterThan(13);
    expect(niamey!.lat, 'Niamey latitude ~13.5').toBeLessThan(14);
    expect(niamey!.lng, 'Niamey longitude ~2.1').toBeGreaterThan(1.5);
    expect(niamey!.lng, 'Niamey longitude ~2.1').toBeLessThan(3);
  });

  test('q=tok&country=JP → Tokyo JP in results (country filter)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=tok&country=JP`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{
      name: string;
      countryCode: string;
      lat: number;
      lng: number;
      population: number;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // All results must be Japanese cities (country filter applied)
    for (const city of body) {
      expect(city.countryCode, `${city.name} must be JP`).toBe('JP');
    }

    // Tokyo must appear
    const tokyo = body.find((c) => c.name.toLowerCase().includes('tokyo'));
    expect(tokyo, 'Tokyo JP must be in results for q=tok&country=JP').toBeDefined();
  });

  test('q=par&country=FR → Paris FR in results', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=par&country=FR`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{ name: string; countryCode: string }>;

    const paris = body.find(
      (c) => c.name.toLowerCase() === 'paris' && c.countryCode === 'FR',
    );
    expect(paris, 'Paris FR must appear for q=par&country=FR').toBeDefined();
  });

  test('q="" (empty string) → empty array (DoS guard)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    // The server either returns 400 (validation error) or 200 with []
    // Both are acceptable — what is NOT acceptable is returning results for an empty query.
    const status = res.status();
    if (status === 200) {
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length, 'empty q must return empty results').toBe(0);
    } else {
      // 400 is the expected Zod validation error for q < 2 chars
      expect(status).toBe(400);
    }
  });

  test('q=a (single char) → empty array or 400 (DoS guard)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=a`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    const status = res.status();
    if (status === 200) {
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length, 'single-char q must return empty results').toBe(0);
    } else {
      expect(status).toBe(400);
    }
  });

  test('limit parameter is respected (limit=3 → at most 3 results)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=ma&limit=3`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length, 'limit=3 must return at most 3 items').toBeLessThanOrEqual(3);
  });

  test('results are sorted by population descending', async ({ request }) => {
    // Use "par" which matches many European cities so we get a multi-item result
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=par&limit=10`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{ name: string; population: number }>;
    expect(body.length).toBeGreaterThan(1);

    // Verify monotonically non-increasing population
    for (let i = 1; i < body.length; i++) {
      expect(
        body[i]!.population,
        `${body[i]!.name} (pop ${body[i]!.population}) must not exceed ${body[i - 1]!.name} (pop ${body[i - 1]!.population})`,
      ).toBeLessThanOrEqual(body[i - 1]!.population);
    }
  });

  test('accent-insensitive: q=niame (without accent) finds Niamey', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=niame`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{ name: string; countryCode: string }>;
    const niamey = body.find(
      (c) => c.name.toLowerCase().includes('niamey') && c.countryCode === 'NE',
    );
    expect(niamey, 'accent-insensitive search must find Niamey').toBeDefined();
  });

  test('case-insensitive: q=NIAM (uppercase) finds Niamey', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=NIAM`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{ name: string; countryCode: string }>;
    const niamey = body.find(
      (c) => c.name.toLowerCase().includes('niamey') && c.countryCode === 'NE',
    );
    expect(niamey, 'case-insensitive search must find Niamey').toBeDefined();
  });

  test('worldwide non-diaspora city: q=mun&country=DE → Munich DE with German coords', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/geo/cities?q=mun&country=DE`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect(res.status()).toBe(200);
    const body = await res.json() as Array<{
      name: string;
      countryCode: string;
      lat: number;
      lng: number;
      population: number;
    }>;
    // Munich (München) should appear — altName indexing
    const munich = body.find(
      (c) => c.countryCode === 'DE' && (c.name.toLowerCase().includes('munich') || c.name.toLowerCase().includes('münchen')),
    );
    expect(munich, 'Munich DE must appear for q=mun&country=DE').toBeDefined();
    if (munich) {
      // Munich is at ~48.1°N, ~11.6°E
      expect(munich.lat).toBeGreaterThan(47);
      expect(munich.lat).toBeLessThan(49);
      expect(munich.lng).toBeGreaterThan(11);
      expect(munich.lng).toBeLessThan(13);
    }
  });

  test('no q param → 400 validation error', async ({ request }) => {
    // q is required by citiesQuerySchema (min 2 chars)
    const res = await request.get(`${BASE_URL}/api/geo/cities`, { headers: { 'X-Forwarded-For': uniqueIp() } });
    expect([400, 422]).toContain(res.status());
  });
});
