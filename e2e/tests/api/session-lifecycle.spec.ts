/**
 * TARGET 2 — Shared Session Lifecycle Tests
 *
 * OAuth sign-in issues the same JWT access/refresh tokens as email/password
 * login.  These tests prove the token pipeline end-to-end against the live API:
 *
 *   register → login → /me (serializer check) → refresh (rotation) →
 *   refresh-reuse-attack → logout → post-logout-refresh-rejected
 *
 * Each test creates its own throwaway user (e2etest+<random>@nigerconnect.test)
 * and sends a unique X-Forwarded-For IP so the per-IP rate limiter (3 register/min)
 * does not interfere with parallel test workers.
 *
 * The TRUST_PROXY_HOPS=1 setting in main.ts means Express reads req.ip from
 * X-Forwarded-For[0], so spoofing it is intentional in this dev-only context.
 *
 * Sensitive-field leak check:
 *   GET /api/auth/me must NOT return passwordHash, oauthProviderId, mfaSecret,
 *   failedLoginCount, lockedUntil, lastLoginIp in the user object.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENSITIVE_FIELDS = [
  'passwordHash',
  'password_hash',
  'oauthProviderId',
  'oauth_provider_id',
  'mfaSecret',
  'mfa_secret',
  'failedLoginCount',
  'failed_login_count',
  'lockedUntil',
  'locked_until',
  'lastLoginIp',
  'last_login_ip',
] as const;

/** RFC-1918 private address in 10.x.x.x range, unique per call. */
function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `e2etest+${rand}@nigerconnect.test`;
}

const VALID_PASSWORD = 'E2eTest#2026!z';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  user: Record<string, unknown>;
  tokens: TokenPair;
}

/**
 * Register a new user using a unique forwarded IP to avoid hitting the
 * per-IP register throttle (3 requests/minute).
 */
async function register(
  request: APIRequestContext,
  email: string,
  ip?: string,
): Promise<AuthResponse> {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip ?? uniqueIp() };
  const res = await request.post('/api/auth/register', {
    data: { email, password: VALID_PASSWORD, firstName: 'E2E', lastName: 'Test' },
    headers,
  });
  expect(res.status(), `register ${email} → expected 201, got ${res.status()}`).toBe(201);
  return (await res.json()) as AuthResponse;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Auth session lifecycle', () => {

  test('register → returns 201 with user + tokens', async ({ request }) => {
    const email = randomEmail();
    const res = await request.post('/api/auth/register', {
      data: { email, password: VALID_PASSWORD, firstName: 'E2E', lastName: 'Playwright' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as AuthResponse;
    expect(body.user).toBeTruthy();
    expect(body.user['email']).toBe(email);
    expect(typeof body.tokens.accessToken).toBe('string');
    expect(typeof body.tokens.refreshToken).toBe('string');
    expect(body.tokens.accessToken.length).toBeGreaterThan(10);
    expect(body.tokens.refreshToken.length).toBeGreaterThan(10);
  });

  test('duplicate register → 409 Conflict', async ({ request }) => {
    const ip = uniqueIp();
    const email = randomEmail();
    // First registration uses IP-A
    await register(request, email, ip);
    // Duplicate uses a fresh IP (different rate-limit bucket)
    const res = await request.post('/api/auth/register', {
      data: { email, password: VALID_PASSWORD, firstName: 'E2E', lastName: 'Dupe' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(409);
  });

  test('register with weak password → 400', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { email: randomEmail(), password: 'short', firstName: 'X', lastName: 'Y' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
  });

  test('login → 200 with tokens', async ({ request }) => {
    const email = randomEmail();
    await register(request, email);
    const res = await request.post('/api/auth/login', {
      data: { email, password: VALID_PASSWORD },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as AuthResponse;
    expect(typeof body.tokens.accessToken).toBe('string');
    expect(typeof body.tokens.refreshToken).toBe('string');
  });

  test('login with wrong password → 401', async ({ request }) => {
    const email = randomEmail();
    await register(request, email);
    const res = await request.post('/api/auth/login', {
      data: { email, password: 'WrongPassword#99' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me → 200, correct user, no sensitive fields leaked', async ({ request }) => {
    const email = randomEmail();
    const { tokens } = await register(request, email);
    const res = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { user: Record<string, unknown> };
    expect(body.user).toBeTruthy();
    expect(body.user['email']).toBe(email);

    // Serializer must strip all sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      expect(
        Object.prototype.hasOwnProperty.call(body.user, field),
        `GET /me must not expose ${field}`,
      ).toBe(false);
    }
  });

  test('GET /api/auth/me without token → 401', async ({ request }) => {
    const res = await request.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me with expired/garbage token → 401', async ({ request }) => {
    const res = await request.get('/api/auth/me', {
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/refresh → 200, returns NEW token pair', async ({ request }) => {
    const email = randomEmail();
    const { tokens: firstTokens } = await register(request, email);
    const res = await request.post('/api/auth/refresh', {
      data: { refreshToken: firstTokens.refreshToken },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as AuthResponse;
    expect(typeof body.tokens.accessToken).toBe('string');
    expect(typeof body.tokens.refreshToken).toBe('string');
    // Tokens must be different (rotation)
    expect(body.tokens.accessToken).not.toBe(firstTokens.accessToken);
    expect(body.tokens.refreshToken).not.toBe(firstTokens.refreshToken);
  });

  test('refresh token rotation: reusing old refresh token → 401 (replay detection)', async ({ request }) => {
    const email = randomEmail();
    const { tokens: firstTokens } = await register(request, email);

    // Consume the token once
    const res1 = await request.post('/api/auth/refresh', {
      data: { refreshToken: firstTokens.refreshToken },
    });
    expect(res1.status()).toBe(200);

    // Reuse the same (now-consumed) refresh token
    const res2 = await request.post('/api/auth/refresh', {
      data: { refreshToken: firstTokens.refreshToken },
    });
    expect(res2.status()).toBe(401);
  });

  test('POST /api/auth/refresh with garbage token → 401', async ({ request }) => {
    const res = await request.post('/api/auth/refresh', {
      data: { refreshToken: 'totally-fake-refresh-token' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/logout → 204; subsequent refresh rejected → 401', async ({ request }) => {
    const email = randomEmail();
    const { tokens } = await register(request, email);

    // Logout requires valid access token + refresh token body
    const logoutRes = await request.post('/api/auth/logout', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      data: { refreshToken: tokens.refreshToken },
    });
    expect(logoutRes.status()).toBe(204);

    // Try to refresh after logout — must be rejected
    const refreshRes = await request.post('/api/auth/refresh', {
      data: { refreshToken: tokens.refreshToken },
    });
    expect(refreshRes.status()).toBe(401);
  });

  test('POST /api/auth/logout without auth → 401', async ({ request }) => {
    const res = await request.post('/api/auth/logout', {
      data: { refreshToken: 'anything' },
    });
    expect(res.status()).toBe(401);
  });

  test('serializer: register response user object has no sensitive fields', async ({ request }) => {
    const { user } = await register(request, randomEmail());
    for (const field of SENSITIVE_FIELDS) {
      expect(
        Object.prototype.hasOwnProperty.call(user, field),
        `register response must not expose ${field}`,
      ).toBe(false);
    }
  });

  test('serializer: login response user object has no sensitive fields', async ({ request }) => {
    const email = randomEmail();
    await register(request, email);
    const res = await request.post('/api/auth/login', {
      data: { email, password: VALID_PASSWORD },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    const body = await res.json() as AuthResponse;
    for (const field of SENSITIVE_FIELDS) {
      expect(
        Object.prototype.hasOwnProperty.call(body.user, field),
        `login response must not expose ${field}`,
      ).toBe(false);
    }
  });

  test('cross-account isolation: user A cannot read user B data via /me', async ({ request }) => {
    // Both users register independently and get distinct tokens
    const emailA = randomEmail();
    const emailB = randomEmail();
    const { tokens: tokensA } = await register(request, emailA);
    const { tokens: tokensB } = await register(request, emailB);

    // Each token only returns the owner's profile
    const resA = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    const resB = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${tokensB.accessToken}` },
    });
    expect(resA.status()).toBe(200);
    expect(resB.status()).toBe(200);
    const bodyA = await resA.json() as { user: Record<string, unknown> };
    const bodyB = await resB.json() as { user: Record<string, unknown> };
    expect(bodyA.user['email']).toBe(emailA);
    expect(bodyB.user['email']).toBe(emailB);
    expect(bodyA.user['id']).not.toBe(bodyB.user['id']);

    // Swapped — neither token exposes the other's email
    expect(bodyA.user['email']).not.toBe(emailB);
    expect(bodyB.user['email']).not.toBe(emailA);
  });
});
