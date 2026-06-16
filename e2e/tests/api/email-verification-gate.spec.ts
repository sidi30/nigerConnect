/**
 * EmailVerifiedGuard contract tests
 *
 * Verifies the behaviour of the global EmailVerifiedGuard introduced to block
 * authenticated-but-unverified users from reaching protected routes.
 *
 * Rules under test:
 *   - @AllowUnverified routes are reachable with an unverified account.
 *   - @Public routes need no token at all and are unaffected.
 *   - All other authenticated routes return 403 {code:'EMAIL_NOT_VERIFIED'} for
 *     a freshly-registered (unverified) user.
 *   - Once the DB row is updated (email_verified = true) the same routes become
 *     accessible.
 *   - POST /api/auth/logout works for an unverified user (@AllowUnverified).
 *   - POST /api/auth/verify-email/send works for an unverified user (@AllowUnverified).
 *
 * DB mutations are made via `docker exec … psql` — the same pattern used in
 * mobile-fixes-contract.spec.ts.  This avoids wiring up the full email
 * verification flow in tests that target the guard itself.
 *
 * Prerequisites:
 *   API_BASE_URL=http://127.0.0.1:3000
 *   Postgres accessible via nigerconnect-postgres container (port 5433)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Mark a user's email as verified directly in the DB.
 * Column name: `email_verified` (Prisma @map of field `emailVerified`).
 */
function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
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
  return `e2everify+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: TokenPair;
}

/**
 * Register a new user and return user + tokens.
 * The user is NOT email-verified after this call (emailVerified defaults to
 * false in the DB).
 */
async function register(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'VerifyGate', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('EmailVerifiedGuard', () => {
  // ── @AllowUnverified routes ────────────────────────────────────────────────

  test('GET /api/auth/me → 200 for a freshly-registered (unverified) user (@AllowUnverified)', async ({
    request,
  }) => {
    const email = randomEmail();
    const { tokens } = await register(request, email);

    const res = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user['email']).toBe(email);
    // emailVerified must be false — the user has not verified yet
    expect(body.user['emailVerified']).toBe(false);
  });

  test('POST /api/auth/verify-email/send → 200 for an unverified user (@AllowUnverified)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, randomEmail());
    void user;

    const res = await request.post(`${BASE_URL}/api/auth/verify-email/send`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    // The route sends an email; in dev the SMTP call may silently succeed or
    // error but the HTTP response must not be 403 EMAIL_NOT_VERIFIED.
    expect(res.status(), `verify-email/send must not be blocked by guard (got ${res.status()})`).not.toBe(403);
    // The controller declares @HttpCode(NO_CONTENT) → 204.
    expect(res.status()).toBe(204);
  });

  test('POST /api/auth/logout → 204 for an unverified user (@AllowUnverified)', async ({
    request,
  }) => {
    const { tokens } = await register(request, randomEmail());

    const logoutRes = await request.post(`${BASE_URL}/api/auth/logout`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      data: { refreshToken: tokens.refreshToken },
    });
    expect(logoutRes.status()).toBe(204);
  });

  // ── Protected route blocked for unverified user ────────────────────────────

  test('GET /api/feed → 403 EMAIL_NOT_VERIFIED for an unverified user', async ({ request }) => {
    const { tokens } = await register(request, randomEmail());

    const res = await request.get(`${BASE_URL}/api/feed`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });

  test('POST /api/posts → 403 EMAIL_NOT_VERIFIED for an unverified user', async ({ request }) => {
    const { tokens } = await register(request, randomEmail());

    const res = await request.post(`${BASE_URL}/api/posts`, {
      data: { content: 'Should be blocked', visibility: 'public' },
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });

  // ── Protected route accessible after email verification ───────────────────

  test('GET /api/feed → 200 after email_verified set to true in DB', async ({ request }) => {
    const { user, tokens } = await register(request, randomEmail());

    // Confirm guard fires before verification
    const before = await request.get(`${BASE_URL}/api/feed`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(before.status()).toBe(403);

    // Verify email in DB (simulates the user clicking the verification link)
    verifyEmailInDb(user.id);

    // Same token, same route — must now be allowed
    const after = await request.get(`${BASE_URL}/api/feed`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(after.status()).toBe(200);
  });

  test('POST /api/posts → 201 after email_verified set to true in DB', async ({ request }) => {
    const { user, tokens } = await register(request, randomEmail());
    verifyEmailInDb(user.id);

    const res = await request.post(`${BASE_URL}/api/posts`, {
      data: { content: 'Post after email verification', visibility: 'public' },
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(201);
  });

  // ── Unauthenticated requests are unaffected ────────────────────────────────

  test('GET /api/auth/me without token → still 401 (guard does not interfere with unauthenticated requests)', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/auth/me`);
    expect(res.status()).toBe(401);
  });
});
