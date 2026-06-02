/**
 * TARGET 1 — OAuth API Contract Tests
 *
 * Tests POST /api/auth/google and POST /api/auth/apple against a live API.
 * No browser — uses Playwright's APIRequestContext only.
 *
 * What we assert:
 *  - Routes exist (not 404)
 *  - Missing / empty / wrong-type tokens → 400 (Zod validation before any network call)
 *  - Syntactically-garbage tokens → 401 (failed signature verification)
 *  - Structurally-valid-but-unsigned JWT → 401
 *  - Error bodies contain a "message" field but NO stack traces / internals
 *
 * What we deliberately do NOT test:
 *  - A real Google/Apple token that would pass — those require live OAuth flows
 *    on a mobile device.  The 401 path proves the verifier runs; the 400 paths
 *    prove Zod runs before the verifier.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * RFC-1918 private address, unique per call.
 * Sent as X-Forwarded-For so the global throttler (trust proxy = 1) sees a
 * distinct IP for each test, preventing the shared 127.0.0.1 bucket from
 * exhausting the per-IP rate limits when tests run in parallel or in
 * rapid succession.
 */
function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

/** Build a structurally-valid but unsigned JWT (header.payload.signature). */
function fakeJwt(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ iss: 'accounts.google.com', sub: '12345', iat: 0, exp: 9999999999, ...payload }),
  ).toString('base64url');
  const sig = Buffer.from('invalidsignature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Assert error body is safe: has a "message" field, no stack trace,
 * no internal module paths, no Prisma/DB error strings.
 */
function assertSafeError(body: Record<string, unknown>, context: string) {
  expect(body, `${context}: body should be an object`).toBeTruthy();

  // Must carry a human-readable message
  expect(typeof body['message'], `${context}: message should be string`).toBe('string');

  const bodyStr = JSON.stringify(body);

  // No stack traces
  expect(bodyStr, `${context}: must not leak stack trace`).not.toContain('at Object.');
  expect(bodyStr, `${context}: must not leak stack trace`).not.toContain('.ts:');
  expect(bodyStr, `${context}: must not leak stack trace`).not.toContain('.js:');

  // No internal module paths (Windows or POSIX)
  expect(bodyStr, `${context}: must not leak file paths`).not.toMatch(/[A-Z]:\\/);
  expect(bodyStr, `${context}: must not leak file paths`).not.toContain('node_modules');
  expect(bodyStr, `${context}: must not leak file paths`).not.toContain('/src/');

  // No raw DB errors
  expect(bodyStr, `${context}: must not leak DB errors`).not.toContain('PrismaClientKnownRequestError');
  expect(bodyStr, `${context}: must not leak DB errors`).not.toContain('prisma');
  expect(bodyStr, `${context}: must not leak DB errors`).not.toContain('PostgreSQL');
}

// ── Google endpoint ──────────────────────────────────────────────────────────

test.describe('POST /api/auth/google', () => {

  test('route exists — does not 404', async ({ request }: { request: APIRequestContext }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: 'probe' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), 'route must not 404').not.toBe(404);
  });

  test('garbage idToken → 401 "Invalid Google ID token"', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: 'garbage' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body['message']).toBe('string');
    expect((body['message'] as string).toLowerCase()).toContain('invalid google');
    assertSafeError(body, 'google/garbage-idToken');
  });

  test('structurally-valid-but-unsigned JWT → 401', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: fakeJwt() },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'google/fake-jwt');
  });

  test('missing idToken (empty body {}) → 400 Zod validation', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: {},
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'google/empty-body');
    // Should name the failing field
    expect(JSON.stringify(body)).toContain('idToken');
  });

  test('empty string idToken → 400 Zod validation (min:1)', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: '' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'google/empty-string-idToken');
  });

  test('numeric idToken → 400 Zod validation (must be string)', async ({ request }) => {
    // Send raw JSON so the number is not coerced to string by a higher layer
    const res = await request.post('/api/auth/google', {
      data: '{"idToken":123}',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'google/numeric-idToken');
  });

  test('valid nonce forwarded but token invalid → still 401 (not 500)', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: 'x.y.z', nonce: 'abc123nonce' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'google/with-nonce');
  });

  test('extra unknown fields are ignored, validation still runs', async ({ request }) => {
    const res = await request.post('/api/auth/google', {
      data: { idToken: 'bad', extra: 'ignored', foo: true },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    // Has idToken so Zod passes, but token is invalid → 401
    expect(res.status()).toBe(401);
  });
});

// ── Apple endpoint ───────────────────────────────────────────────────────────

test.describe('POST /api/auth/apple', () => {

  test('route exists — does not 404', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: { identityToken: 'probe' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), 'route must not 404').not.toBe(404);
  });

  test('garbage identityToken → 401', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: { identityToken: 'garbage' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/garbage-identityToken');
  });

  test('structurally-valid-but-unsigned JWT → 401', async ({ request }) => {
    const appleJwt = fakeJwt({ iss: 'https://appleid.apple.com', aud: 'com.example.app' });
    const res = await request.post('/api/auth/apple', {
      data: { identityToken: appleJwt },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/fake-jwt');
  });

  test('missing identityToken → 400 Zod validation', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: {},
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/empty-body');
    expect(JSON.stringify(body)).toContain('identityToken');
  });

  test('empty string identityToken → 400 Zod validation (min:1)', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: { identityToken: '' },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/empty-string-identityToken');
  });

  test('numeric identityToken → 400 Zod validation', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: '{"identityToken":123}',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/numeric-identityToken');
  });

  test('optional fields (fullName, email, rawNonce) accepted alongside bad token → 401', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: {
        identityToken: 'garbage',
        fullName: { givenName: 'Test', familyName: 'User' },
        email: 'test@privaterelay.appleid.com',
        rawNonce: 'somenonce',
      },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    // Zod accepts the shape; token is invalid so → 401
    expect(res.status()).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/with-optional-fields');
  });

  test('malformed fullName field → 400 Zod validation', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: {
        identityToken: 'garbage',
        fullName: 'not-an-object',
      },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/bad-fullName');
  });

  test('invalid email format on optional email field → 400', async ({ request }) => {
    const res = await request.post('/api/auth/apple', {
      data: {
        identityToken: 'garbage',
        email: 'not-an-email',
      },
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    assertSafeError(body, 'apple/invalid-email');
  });
});
