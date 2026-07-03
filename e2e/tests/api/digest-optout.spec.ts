/**
 * digest-optout.spec.ts — E-DIGEST QA (spec memory/spec-edigest.md).
 *
 * E-DIGEST is a CRON feature (setInterval, no-op under NODE_ENV=test) — the
 * aggregate computation, privacy filtering, idempotence and kill-switch have no
 * HTTP surface and are proven at the jest unit layer (apps/api/src/digest/
 * digest.service.spec.ts, 9 tests green):
 *   AC-F1-03 privacy: counts ONLY public+active; payload = plain numbers only.
 *   AC-F2-02 idempotence: stamp BEFORE push, no double-send on re-run.
 *   AC-F5-01 kill-switch fail-closed: digest_enabled off (default) ⇒ 0 push.
 *
 * The ONE user-facing HTTP surface is F3 — the opt-out toggle — which this spec
 * covers end-to-end:
 *   AC-F3-01/02 the digestOptIn flag round-trips through PATCH /profile/me and is
 *               persisted (readable via GET /profile/me), default ON (opt-out model).
 *   AC-F3-02 err a non-boolean digestOptIn is rejected by Zod (400).
 *   AC-F3    independence: toggling digestOptIn does not touch newsletterOptIn.
 *
 * Prerequisites: API on http://127.0.0.1:3000, Postgres (psql).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(prefix = 'e2edigest'): string {
  return `${prefix}+${Date.now()}${Math.random().toString(36).slice(2, 7)}@nigerconnect.test`;
}

interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: { accessToken: string; refreshToken: string };
}

async function registerVerified(request: APIRequestContext): Promise<AuthResponse> {
  const email = randomEmail();
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'DigE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `register: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as AuthResponse;
  psql(`UPDATE users SET email_verified = true WHERE id = '${body.user.id}';`);
  return body;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

async function getMe(request: APIRequestContext, token: string) {
  const res = await request.get(`${BASE_URL}/api/profile/me`, { headers: authHeaders(token) });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { user: { digestOptIn?: boolean; newsletterOptIn?: boolean } };
}

test.describe('E-DIGEST F3 — opt-out toggle (PATCH /profile/me)', () => {
  test('AC-F3-01 — digestOptIn defaults to ON (opt-out model)', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const me = await getMe(request, tokens.accessToken);
    // Exposed by USER_SELF_SELECT; default true at the DB level.
    expect(me.user.digestOptIn).toBe(true);
  });

  test('AC-F3-02 — disabling the digest persists and is readable back', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const patch = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: false },
      headers: authHeaders(tokens.accessToken),
    });
    expect(patch.status(), await patch.text()).toBe(200);
    const patched = (await patch.json()) as { user: { digestOptIn?: boolean } };
    expect(patched.user.digestOptIn).toBe(false);

    // Durable: a fresh read reflects the opt-out.
    const me = await getMe(request, tokens.accessToken);
    expect(me.user.digestOptIn).toBe(false);
  });

  test('AC-F3-02 — re-enabling works too (round-trips both ways)', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: false },
      headers: authHeaders(tokens.accessToken),
    });
    const re = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: true },
      headers: authHeaders(tokens.accessToken),
    });
    expect(re.status()).toBe(200);
    const me = await getMe(request, tokens.accessToken);
    expect(me.user.digestOptIn).toBe(true);
  });

  test('AC-F3-02 err — a non-boolean digestOptIn is rejected by Zod (400)', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const res = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: 'nope' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(400);
  });

  test('AC-F3 — digestOptIn is independent of newsletterOptIn', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const before = await getMe(request, tokens.accessToken);
    const newsletterBefore = before.user.newsletterOptIn;

    // Turn the digest OFF; the newsletter flag must be untouched (separate column).
    await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: false },
      headers: authHeaders(tokens.accessToken),
    });
    const after = await getMe(request, tokens.accessToken);
    expect(after.user.digestOptIn).toBe(false);
    expect(after.user.newsletterOptIn).toBe(newsletterBefore);
  });

  test('opt-out requires authentication (401)', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/profile/me`, {
      data: { digestOptIn: false },
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
  });
});
