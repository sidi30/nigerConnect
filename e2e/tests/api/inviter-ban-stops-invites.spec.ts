/**
 * inviter-ban-stops-invites.spec.ts
 *
 * CRITICAL regression (security fix #1): a banned or abuse-frozen inviter's
 * invitation codes — including reusable mass-invite links that stay 'pending'
 * forever — must STOP onboarding new accounts.
 *
 * Before the fix, a reusable link minted by a user who was later banned (or
 * frozen at inviteAbuseFlags >= 3) kept validating and kept creating accounts,
 * because the invitation row itself was still 'pending'. The fix adds an inviter
 * state gate to BOTH:
 *   - GET  /api/invitations/check?code=…        → { valid:false }
 *   - POST /api/auth/register { inviteCode }     → 403 INVALID_INVITE_CODE
 * The 403 message is deliberately generic (does not reveal the inviter is
 * banned — same response as an invalid code).
 *
 * Strategy:
 *   - Mint a reusable link while the inviter is healthy, prove a signup works in
 *     invite_only, THEN flip the inviter to banned / abuse-frozen via _db-exec
 *     and assert both doors close. A single_use code is checked the same way.
 *
 * Mutates registration_mode → runs with fullyParallel:false + workers:1
 * (see playwright.config.ts), same discipline as the parrainage specs.
 *
 * Prerequisites: NestJS on :3000, Postgres + Redis reachable (docker exec
 * locally, DATABASE_URL/REDIS_URL in CI), app_settings registration_mode='open'.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql, redisDel } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ─────────────────────────────────────────────────────────────────

function runSql(sql: string): string {
  return psql(sql);
}
function verifyEmailInDb(userId: string): void {
  runSql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}
function setBulkInviteInDb(userId: string, allowed: boolean): void {
  runSql(`UPDATE users SET can_bulk_invite = ${allowed} WHERE id = '${userId}';`);
}
function setUserStatusInDb(userId: string, status: 'active' | 'suspended' | 'banned'): void {
  runSql(`UPDATE users SET status = '${status}' WHERE id = '${userId}';`);
}
function setAbuseFlagsInDb(userId: string, flags: number): void {
  runSql(`UPDATE users SET invite_abuse_flags = ${flags} WHERE id = '${userId}';`);
}
function setRegistrationModeInDb(mode: 'open' | 'invite_only' | 'closed'): void {
  runSql(`UPDATE app_settings SET value = '${mode}' WHERE key = 'registration_mode';`);
  redisDel('setting:registration_mode');
}
function resetRegistrationModeToOpen(): void {
  setRegistrationModeInDb('open');
}
function revokeAllPendingInvitesInDb(inviterId: string): void {
  runSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = now(), target_email = null WHERE inviter_id = '${inviterId}' AND status = 'pending';`,
  );
}

// ── Request helpers ────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(prefix = 'e2eban'): string {
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

async function registerRaw(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'BanE2E', lastName: 'Test', ...extra },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  return { status: res.status(), body: await res.json() };
}

async function login(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `login ${email} → 200`).toBe(200);
  return (await res.json()) as AuthResponse;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

/** Register a verified user and return its id + an authed token. */
async function setupVerifiedUser(
  request: APIRequestContext,
): Promise<{ userId: string; email: string; tokens: TokenPair }> {
  const email = randomEmail();
  const { status, body } = await registerRaw(request, email);
  expect(status, `setup register → 201: ${JSON.stringify(body)}`).toBe(201);
  const userId = (body as AuthResponse).user.id;
  verifyEmailInDb(userId);
  const { tokens } = await login(request, email);
  return { userId, email, tokens };
}

async function checkCode(
  request: APIRequestContext,
  code: string,
): Promise<{ valid: boolean; kind?: string }> {
  const res = await request.get(`${BASE_URL}/api/invitations/check?code=${code}`, {
    headers: { 'X-Forwarded-For': uniqueIp() },
  });
  expect(res.status(), 'check endpoint → 200').toBe(200);
  return (await res.json()) as { valid: boolean; kind?: string };
}

// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('CRITICAL — banned / abuse-frozen inviter stops onboarding', () => {
  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('reusable link from a BANNED inviter: check→valid:false AND register→403 INVALID_INVITE_CODE', async ({
    request,
  }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupVerifiedUser(request);
    setBulkInviteInDb(inviter.userId, true);
    const inviterTokens = (await login(request, inviter.email)).tokens;

    // Mint a reusable mass-invite link while the inviter is healthy.
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(createRes.status(), 'reusable creation → 201').toBe(201);
    const link = (await createRes.json()) as { id: string; code: string; kind: string };
    expect(link.kind).toBe('reusable');

    setRegistrationModeInDb('invite_only');
    try {
      // Baseline: while inviter is healthy, the reusable code onboards in invite_only.
      const baseline = await registerRaw(request, randomEmail('healthy'), {
        inviteCode: link.code,
      });
      expect(baseline.status, `baseline signup must work: ${JSON.stringify(baseline.body)}`).toBe(201);

      // Healthy check must be valid before the ban.
      expect((await checkCode(request, link.code)).valid, 'code valid before ban').toBe(true);

      // ── BAN the inviter ──
      setUserStatusInDb(inviter.userId, 'banned');

      // (a) check endpoint now reports the code as invalid.
      const afterBan = await checkCode(request, link.code);
      expect(afterBan.valid, 'banned inviter → reusable code must report valid:false').toBe(false);

      // (b) register with the code is rejected 403 INVALID_INVITE_CODE.
      const reg = await registerRaw(request, randomEmail('afterban'), { inviteCode: link.code });
      expect(
        reg.status,
        `banned inviter reusable code register must be 403, got ${reg.status}: ${JSON.stringify(reg.body)}`,
      ).toBe(403);
      expect((reg.body as Record<string, unknown>)['code']).toBe('INVALID_INVITE_CODE');
    } finally {
      setUserStatusInDb(inviter.userId, 'active');
      resetRegistrationModeToOpen();
      revokeAllPendingInvitesInDb(inviter.userId);
    }
  });

  test('reusable link from an ABUSE-FROZEN inviter (inviteAbuseFlags>=3): check→valid:false AND register→403', async ({
    request,
  }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupVerifiedUser(request);
    setBulkInviteInDb(inviter.userId, true);
    const inviterTokens = (await login(request, inviter.email)).tokens;

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const link = (await createRes.json()) as { id: string; code: string };

    setRegistrationModeInDb('invite_only');
    try {
      expect((await checkCode(request, link.code)).valid, 'valid before freeze').toBe(true);

      // ── FREEZE the inviter (abuse threshold = 3) ──
      setAbuseFlagsInDb(inviter.userId, 3);

      const afterFreeze = await checkCode(request, link.code);
      expect(afterFreeze.valid, 'abuse-frozen inviter → code must report valid:false').toBe(false);

      const reg = await registerRaw(request, randomEmail('afterfreeze'), { inviteCode: link.code });
      expect(
        reg.status,
        `abuse-frozen inviter reusable code register must be 403, got ${reg.status}: ${JSON.stringify(reg.body)}`,
      ).toBe(403);
      expect((reg.body as Record<string, unknown>)['code']).toBe('INVALID_INVITE_CODE');
    } finally {
      setAbuseFlagsInDb(inviter.userId, 0);
      resetRegistrationModeToOpen();
      revokeAllPendingInvitesInDb(inviter.userId);
    }
  });

  test('single_use code from a BANNED inviter is also rejected (403) and reports valid:false', async ({
    request,
  }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupVerifiedUser(request);
    const inviterTokens = (await login(request, inviter.email)).tokens;

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const inv = (await createRes.json()) as { id: string; code: string; kind: string };
    expect(inv.kind).toBe('single_use');

    setRegistrationModeInDb('invite_only');
    try {
      expect((await checkCode(request, inv.code)).valid, 'valid before ban').toBe(true);

      setUserStatusInDb(inviter.userId, 'banned');

      expect((await checkCode(request, inv.code)).valid, 'banned inviter → single_use invalid').toBe(false);

      const reg = await registerRaw(request, randomEmail('su-afterban'), { inviteCode: inv.code });
      expect(reg.status, `single_use banned inviter register → 403`).toBe(403);
      expect((reg.body as Record<string, unknown>)['code']).toBe('INVALID_INVITE_CODE');
    } finally {
      setUserStatusInDb(inviter.userId, 'active');
      resetRegistrationModeToOpen();
      revokeAllPendingInvitesInDb(inviter.userId);
    }
  });
});
