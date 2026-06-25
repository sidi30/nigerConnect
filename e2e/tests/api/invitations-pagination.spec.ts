/**
 * invitations-pagination.spec.ts
 *
 * Regression for fix #4: GET /api/invitations gains cursor pagination
 * (?limit & ?cursor → optional nextCursor) WITHOUT breaking the legacy shape.
 *
 *   - Un-paginated call (no params) still returns { canBulkInvite, invites:[...] }
 *     with every invite, exactly as the mobile client expects.
 *   - ?limit=1 returns a single invite plus a nextCursor string.
 *   - Following ?cursor=<nextCursor> returns the next page (a different invite).
 *   - Walking the cursor visits every invite exactly once with no overlap.
 *
 * Open mode only — no registration_mode mutation, so this is parallel-safe.
 *
 * Prerequisites: NestJS on :3000, Postgres + Redis reachable.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql, redisDel } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

function runSql(sql: string): string {
  return psql(sql);
}
function verifyEmailInDb(userId: string): void {
  runSql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}
function revokeAllPendingInvitesInDb(inviterId: string): void {
  runSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = now(), target_email = null WHERE inviter_id = '${inviterId}' AND status = 'pending';`,
  );
  redisDel('setting:registration_mode');
}

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(prefix = 'e2epage'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: TokenPair;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

async function setupVerifiedUser(
  request: APIRequestContext,
): Promise<{ userId: string; email: string; tokens: TokenPair }> {
  const email = randomEmail();
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'PageE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `register → 201: ${await res.text()}`).toBe(201);
  const userId = ((await res.json()) as AuthResponse).user.id;
  verifyEmailInDb(userId);

  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(loginRes.status()).toBe(200);
  return { userId, email, tokens: ((await loginRes.json()) as AuthResponse).tokens };
}

interface ListResponse {
  canBulkInvite: boolean;
  invites: Array<{ id: string; code: string; kind: string; status: string }>;
  nextCursor?: string | null;
}

async function list(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<ListResponse> {
  const res = await request.get(`${BASE_URL}/api/invitations${query}`, {
    headers: authHeaders(token),
  });
  expect(res.status(), `GET /invitations${query} → 200`).toBe(200);
  return (await res.json()) as ListResponse;
}

test.describe('GET /api/invitations — cursor pagination (fix #4)', () => {
  test('un-paginated call keeps the legacy { canBulkInvite, invites:[] } shape with all invites', async ({
    request,
  }) => {
    const user = await setupVerifiedUser(request);

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(user.tokens.accessToken),
      });
      expect(r.status()).toBe(201);
      created.push(((await r.json()) as { id: string }).id);
    }

    const body = await list(request, user.tokens.accessToken);
    expect(typeof body.canBulkInvite, 'canBulkInvite still present').toBe('boolean');
    expect(Array.isArray(body.invites), 'invites array still present').toBe(true);
    // All 3 must be present in the default (limit=30) page.
    for (const id of created) {
      expect(body.invites.some((i) => i.id === id), `invite ${id} listed`).toBe(true);
    }

    revokeAllPendingInvitesInDb(user.userId);
  });

  test('?limit=1 returns exactly one invite + a nextCursor; following the cursor pages forward', async ({
    request,
  }) => {
    const user = await setupVerifiedUser(request);

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(user.tokens.accessToken),
      });
      expect(r.status()).toBe(201);
      created.push(((await r.json()) as { id: string }).id);
    }

    // Page 1
    const page1 = await list(request, user.tokens.accessToken, '?limit=1');
    expect(page1.invites, 'limit=1 → exactly one invite').toHaveLength(1);
    expect(typeof page1.nextCursor, 'nextCursor must be a string when more pages remain').toBe('string');
    expect(page1.nextCursor!.length).toBeGreaterThan(0);

    // Page 2 — following the cursor returns a DIFFERENT invite.
    const page2 = await list(
      request,
      user.tokens.accessToken,
      `?limit=1&cursor=${page1.nextCursor}`,
    );
    expect(page2.invites, 'limit=1 page 2 → one invite').toHaveLength(1);
    expect(page2.invites[0]!.id, 'page 2 invite differs from page 1').not.toBe(
      page1.invites[0]!.id,
    );

    // Walk the cursor to exhaustion and assert every invite is visited exactly once.
    const seen = new Set<string>([page1.invites[0]!.id, page2.invites[0]!.id]);
    let cursor = page2.nextCursor;
    let guard = 0;
    while (cursor && guard < 10) {
      const next = await list(request, user.tokens.accessToken, `?limit=1&cursor=${cursor}`);
      if (next.invites.length === 0) break;
      const id = next.invites[0]!.id;
      expect(seen.has(id), `cursor walk must not repeat invite ${id}`).toBe(false);
      seen.add(id);
      cursor = next.nextCursor;
      guard++;
    }
    for (const id of created) {
      expect(seen.has(id), `invite ${id} reached via cursor walk`).toBe(true);
    }

    revokeAllPendingInvitesInDb(user.userId);
  });

  test('last page reports nextCursor null (no over-page)', async ({ request }) => {
    const user = await setupVerifiedUser(request);
    // Exactly 2 invites, fetch with limit=5 → all returned, nextCursor null.
    for (let i = 0; i < 2; i++) {
      const r = await request.post(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(user.tokens.accessToken),
      });
      expect(r.status()).toBe(201);
    }
    const body = await list(request, user.tokens.accessToken, '?limit=5');
    expect(body.invites.length).toBe(2);
    expect(body.nextCursor ?? null, 'no further page → nextCursor null').toBeNull();

    revokeAllPendingInvitesInDb(user.userId);
  });

  test('invalid limit (0) → 400 (Zod min:1)', async ({ request }) => {
    const user = await setupVerifiedUser(request);
    const res = await request.get(`${BASE_URL}/api/invitations?limit=0`, {
      headers: authHeaders(user.tokens.accessToken),
    });
    expect(res.status(), 'limit=0 rejected by Zod').toBe(400);
  });
});
