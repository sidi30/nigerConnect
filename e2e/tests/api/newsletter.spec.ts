/**
 * newsletter.spec.ts
 *
 * Contract tests for the public newsletter endpoints (waitlist / launch
 * announcement). Both are @Public — no auth token required:
 *   POST /api/newsletter/subscribe       { email, source? }
 *   GET  /api/newsletter/unsubscribe?token=…   → branded HTML page
 *
 * Also asserts the admin console is locked down:
 *   GET /api/admin/newsletter/subscribers (no token) → 401
 *
 * Assertions:
 *   1. subscribe with a valid email → 200 { ok: true }, no auth header
 *   2. subscribe is idempotent (same email twice → both 200)
 *   3. subscribe with an invalid email → 400
 *   4. unsubscribe with an unknown token → 200 HTML "Lien invalide"
 *   5. admin subscribers list without a token → 401
 *
 * Prerequisites: API running on API_BASE_URL (default http://localhost:3000).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

// Unique X-Forwarded-For per test so parallel workers don't share the tight
// per-IP throttle bucket on /subscribe (5/min).
function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

// Unique email per run so re-running the suite doesn't depend on prior state.
function uniqueEmail(): string {
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `waitlist+${r}@example.com`;
}

test.describe('Newsletter — public endpoints', () => {
  test('@Public — subscribe with a valid email returns 200 { ok: true }', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/newsletter/subscribe`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
      data: { email: uniqueEmail(), source: 'landing' },
    });
    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test('subscribe is idempotent — same email twice both 200', async ({ request }) => {
    const ip = uniqueIp();
    const email = uniqueEmail();
    const first = await request.post(`${BASE_URL}/api/newsletter/subscribe`, {
      headers: { 'X-Forwarded-For': ip },
      data: { email },
    });
    expect(first.status()).toBe(200);
    const second = await request.post(`${BASE_URL}/api/newsletter/subscribe`, {
      headers: { 'X-Forwarded-For': ip },
      data: { email },
    });
    expect(second.status(), 'duplicate subscribe must not error').toBe(200);
  });

  test('subscribe with an invalid email → 400', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/newsletter/subscribe`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
      data: { email: 'not-an-email' },
    });
    expect(res.status()).toBe(400);
  });

  test('unsubscribe with an unknown token → 200 HTML "Lien invalide"', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/newsletter/unsubscribe?token=${'0'.repeat(64)}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Lien invalide');
  });

  test('admin subscribers list without a token → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/admin/newsletter/subscribers`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(res.status(), 'admin route must require auth').toBe(401);
  });
});
