/**
 * register-avatar-dropped.spec.ts
 *
 * Regression for fix #2: avatarUrl was removed from the register schema. A raw
 * client-supplied URL must NEVER be persisted at register (it is not S3-bound).
 * The schema is non-strict, so an extra `avatarUrl` field is silently stripped
 * (register still succeeds 201) and the created user's avatar_url stays NULL.
 * The avatar is only ever set later via updateAvatar (which S3-validates ownership).
 *
 * Open mode only — parallel-safe. Each call uses a unique X-Forwarded-For.
 *
 * Prerequisites: NestJS on :3000, Postgres reachable.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eAvi#2026!z';

/** Read avatar_url for a user; returns null when NULL/absent. */
function avatarUrlInDb(userId: string): string | null {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT avatar_url FROM users WHERE id = '${userId}'::uuid) t;`,
  );
  const m = out.match(/\{.*\}/);
  if (!m) return null;
  return (JSON.parse(m[0]) as { avatar_url: string | null }).avatar_url;
}

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2eavatar+${ts}${rand}@nigerconnect.test`;
}

interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: { accessToken: string; refreshToken: string };
}

async function registerRaw(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: AuthResponse }> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'AviE2E', lastName: 'Test', ...extra },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  return { status: res.status(), body: (await res.json()) as AuthResponse };
}

test.describe('POST /api/auth/register — avatarUrl is dropped (fix #2)', () => {
  test('register WITH avatarUrl → 201 and the persisted avatar_url is NULL', async ({ request }) => {
    const malicious = 'https://evil.example.com/not-s3-bound.png';
    const { status, body } = await registerRaw(request, randomEmail(), { avatarUrl: malicious });

    expect(status, 'extra avatarUrl is stripped, register still succeeds').toBe(201);
    const userId = body.user.id;

    // DB is the source of truth: the raw URL must NOT have been persisted.
    expect(avatarUrlInDb(userId), 'client-supplied avatarUrl must not be persisted').toBeNull();

    // And the auth response must not echo the malicious URL back.
    expect(body.user['avatarUrl'] ?? null, 'register response avatarUrl is not the client value').not.toBe(
      malicious,
    );

    // /me must also report no avatar.
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as { user: { avatarUrl: string | null } };
    expect(me.user.avatarUrl ?? null, '/me avatarUrl must not be the client value').not.toBe(malicious);
  });

  test('register WITHOUT avatarUrl → 201, avatar_url NULL (baseline)', async ({ request }) => {
    const { status, body } = await registerRaw(request, randomEmail());
    expect(status).toBe(201);
    expect(avatarUrlInDb(body.user.id), 'fresh user has no avatar').toBeNull();
  });
});
