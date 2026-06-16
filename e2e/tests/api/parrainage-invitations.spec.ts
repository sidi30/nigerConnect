/**
 * parrainage-invitations.spec.ts
 *
 * E2E tests for the referral / invitation ("parrainage") system — contract v2 "réseau".
 * Spec reference: docs/SPEC_PARRAINAGE_V2_RESEAU.md
 *
 * v2 changes reflected here (vs v1):
 *   - NO quota: a verified user may create unlimited invitations.
 *     (no quota/used/available fields, no INVITE_QUOTA_EXCEEDED).
 *   - NO expiration: invitations never expire (no expiresAt-driven 403).
 *   - Two kinds: 'single_use' (email/code, one acceptance) and
 *     'reusable' (mass-invite link, N signups, never consumed).
 *   - 'reusable' requires User.canBulkInvite → otherwise 403 BULK_INVITE_NOT_ALLOWED.
 *   - GET /invitations → { canBulkInvite, invites: [{id,code,url,kind,status,
 *     acceptedBy,signupsCount,createdAt}] }.
 *   - POST /invitations → { id, code, url, kind }.
 *   - GET /invitations/check?code= → { valid, inviterName?, kind? }.
 *   - Profile network: GET /profile/:id exposes { invitedBy, inviteesCount }.
 *   - Admin: GET /admin/referrals lists who-invited-whom;
 *            PATCH /admin/users/:id/bulk-invite grants/revokes canBulkInvite.
 *   - Hard freeze still exists at inviteAbuseFlags >= 3 (not exercised here:
 *     covered by unit tests; would require seeding banned filleuls).
 *
 * Endpoints under test:
 *   GET   /auth/registration-mode
 *   POST  /auth/register        (+inviteCode?)
 *   POST  /auth/google          (+inviteCode?) — only Zod + 401 path; no live token
 *   POST  /auth/apple           (+inviteCode?) — same
 *   POST  /invitations          { email?, kind? }
 *   GET   /invitations
 *   POST  /invitations/:id/revoke
 *   GET   /invitations/check?code=
 *   GET   /admin/settings                (admin + mod)
 *   PATCH /admin/settings                (admin-only)
 *   POST  /admin/invitations/root        (admin-only)
 *   GET   /admin/invitations/metrics     (admin + mod)
 *   PATCH /admin/users/:id/bulk-invite   (admin-only)
 *   GET   /admin/referrals               (admin + mod)
 *   GET   /profile/:id                   (network: invitedBy/inviteesCount)
 *
 * Isolation strategy:
 *   - Each describe block that mutates registration_mode resets it to 'open' in afterAll.
 *   - Registered users use unique emails to avoid inter-test conflicts.
 *   - DB mutations (role promotion, email verify, canBulkInvite grant) go through
 *     the dual-path psql() helper from _db-exec.ts (pg over TCP in CI, docker psql
 *     locally). Redis flushes go through redisDel().
 *   - This spec runs with workers:1 + fullyParallel:false in CI (see playwright.config.ts).
 *
 * Prerequisites (same as all other specs in this directory):
 *   - NestJS API on http://127.0.0.1:3000 (API_BASE_URL override supported)
 *   - Postgres accessible (DATABASE_URL in CI, docker exec nigerconnect-postgres locally)
 *   - Redis on 6379 (REDIS_URL in CI, docker exec nigerconnect-redis locally)
 *   - app_settings seeded (registration_mode='open')
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql, redisDel } from './_db-exec';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ─────────────────────────────────────────────────────────────────

/** Run a SQL statement against the test DB (pg over TCP in CI; docker psql locally). */
function runSql(sql: string): string {
  return psql(sql);
}

function verifyEmailInDb(userId: string): void {
  runSql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function setRoleInDb(userId: string, role: 'admin' | 'moderator' | 'user'): void {
  runSql(`UPDATE users SET role = '${role}' WHERE id = '${userId}';`);
}

/** Grant/revoke the reusable-link (mass invite) right directly in DB. */
function setBulkInviteInDb(userId: string, allowed: boolean): void {
  runSql(`UPDATE users SET can_bulk_invite = ${allowed} WHERE id = '${userId}';`);
}

function setRegistrationModeInDb(mode: 'open' | 'invite_only' | 'closed'): void {
  runSql(`UPDATE app_settings SET value = '${mode}' WHERE key = 'registration_mode';`);
  // Also flush Redis so the API picks it up without waiting for TTL
  redisDel('setting:registration_mode');
}

/** Revoke every pending invitation for cleanup between sub-tests. */
function revokeAllPendingInvitesInDb(inviterId: string): void {
  runSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = now(), target_email = null WHERE inviter_id = '${inviterId}' AND status = 'pending';`,
  );
  redisDel('setting:registration_mode');
}

// ── Request helpers ────────────────────────────────────────────────────────────

/** RFC-1918 IP, unique per call — keeps per-IP throttles from colliding. */
function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

function randomEmail(prefix = 'e2einv'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; firstName?: string; [k: string]: unknown };
  tokens: TokenPair;
}

/** Register a new user with an optional inviteCode. Does NOT assert status — caller checks. */
async function registerRaw(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'InvE2E',
      lastName: 'Test',
      ...extra,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  return { status: res.status(), body: await res.json() };
}

/** Register and assert 201. */
async function register(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const { status, body } = await registerRaw(request, email, extra);
  expect(
    status,
    `register ${email} → expected 201, got ${status}: ${JSON.stringify(body)}`,
  ).toBe(201);
  return body as AuthResponse;
}

/** Login an existing user. */
async function login(
  request: APIRequestContext,
  email: string,
): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `login ${email} → expected 200`).toBe(200);
  return (await res.json()) as AuthResponse;
}

/** Auth headers for authenticated requests. */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

/**
 * Register + verify email + optional role promotion + re-login so token reflects DB role.
 * Re-login is necessary because the JWT encodes role at issue time.
 *
 * Callers must ensure open registration mode BEFORE calling this function.
 */
async function setupUser(
  request: APIRequestContext,
  opts: { role?: 'admin' | 'moderator' | 'user'; verify?: boolean } = {},
): Promise<{ userId: string; email: string; tokens: TokenPair }> {
  const email = randomEmail();
  const { user } = await register(request, email);
  const userId = user.id;

  if (opts.verify !== false) {
    verifyEmailInDb(userId);
  }
  if (opts.role && opts.role !== 'user') {
    setRoleInDb(userId, opts.role);
  }

  // Re-login so the access token carries the promoted role
  const { tokens } = await login(request, email);
  return { userId, email, tokens };
}

// ── Reset helper: call at end of each describe that mutates mode ───────────────

function resetRegistrationModeToOpen(): void {
  setRegistrationModeInDb('open');
}

// ══════════════════════════════════════════════════════════════════════════════
// §1 GET /auth/registration-mode
// ══════════════════════════════════════════════════════════════════════════════

test.describe('GET /api/auth/registration-mode', () => {
  test('returns current mode without auth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/auth/registration-mode`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(['open', 'invite_only', 'closed']).toContain(body.mode);
  });

  test('returns { mode } after admin flips to invite_only', async ({ request }) => {
    const admin = await setupUser(request, { role: 'admin' });
    // Flip via API
    await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'invite_only' },
      headers: authHeaders(admin.tokens.accessToken),
    });
    const res = await request.get(`${BASE_URL}/api/auth/registration-mode`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe('invite_only');

    // Reset
    await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'open' },
      headers: authHeaders(admin.tokens.accessToken),
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 invite_only mode — code gating (single_use)
// ══════════════════════════════════════════════════════════════════════════════

// serial: mode mutation must not race with closed-mode or open-mode describes
test.describe.serial('invite_only mode', () => {
  // Use one admin and one root code shared across all tests in this describe
  let adminTokens: TokenPair;
  let rootCode: string;

  test.beforeAll(async ({ request }) => {
    const admin = await setupUser(request, { role: 'admin' });
    adminTokens = admin.tokens;

    // Switch to invite_only
    const patchRes = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'invite_only' },
      headers: authHeaders(adminTokens.accessToken),
    });
    expect(patchRes.status(), 'PATCH /admin/settings to invite_only').toBe(200);

    // Generate a single root invite for the happy-path tests
    const rootRes = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(adminTokens.accessToken),
    });
    expect(rootRes.status(), 'POST /admin/invitations/root').toBe(201);
    const rootBody = (await rootRes.json()) as Array<{ code: string; url: string }>;
    expect(Array.isArray(rootBody) && rootBody.length).toBeTruthy();
    rootCode = rootBody[0]!.code;
  });

  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  // AC-INV-01
  test('AC-INV-01 — register WITHOUT inviteCode → 403', async ({ request }) => {
    const { status, body } = await registerRaw(request, randomEmail());
    expect(status, `expected 403, got ${status}: ${JSON.stringify(body)}`).toBe(403);
    const b = body as Record<string, unknown>;
    // Should carry a meaningful error code
    const msg = JSON.stringify(b).toLowerCase();
    expect(msg).toMatch(/invitation|invite|code/);
  });

  // AC-INV-02
  test('AC-INV-02 — register WITH valid root code → 201', async ({ request }) => {
    // Each sub-test in this describe needs its own code so they don't share.
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(adminTokens.accessToken),
    });
    const [freshInvite] = (await res.json()) as Array<{ code: string }>;
    const { status, body } = await registerRaw(request, randomEmail(), {
      inviteCode: freshInvite!.code,
    });
    expect(status, `expected 201, got ${status}: ${JSON.stringify(body)}`).toBe(201);
    const b = body as AuthResponse;
    expect(b.user).toBeTruthy();
    expect(typeof b.tokens.accessToken).toBe('string');
  });

  // AC-INV-03 — single_use code only works once.
  test('AC-INV-03 — single_use code REUSED after acceptance → 400 INVITE_CODE_CONSUMED', async ({ request }) => {
    // Generate a dedicated code for this test
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(adminTokens.accessToken),
    });
    const [inv] = (await res.json()) as Array<{ code: string }>;

    // First use: should succeed
    const first = await registerRaw(request, randomEmail(), { inviteCode: inv!.code });
    expect(first.status, `first registration with code must succeed`).toBe(201);

    // Second use of the same code: must be rejected with 400 INVITE_CODE_CONSUMED
    const second = await registerRaw(request, randomEmail(), { inviteCode: inv!.code });
    expect(second.status, 'reused single_use code must be 400').toBe(400);
    const msg = JSON.stringify(second.body).toLowerCase();
    expect(msg).toMatch(/consumed|utilis/);
  });

  // AC-INV-04
  test('AC-INV-04 — POST /auth/google without inviteCode (new account) → not 201', async ({ request }) => {
    // We cannot supply a real Google token. A garbage token fails verification.
    // The critical assertion: it must NOT be 201 (no account created), and the
    // status is 401 (verifier) or 403 (invite gate) — never a created account.
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'fake-google-token-no-invite' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'OAuth without code must not create account (not 201)').not.toBe(201);
    expect([401, 403]).toContain(res.status());
  });

  test('AC-INV-04b — POST /auth/apple without inviteCode (new account) → not 201', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/apple`, {
      data: { identityToken: 'fake-apple-token-no-invite' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'Apple OAuth without code must not create account').not.toBe(201);
    expect([401, 403]).toContain(res.status());
  });

  test('AC-INV-04c — POST /auth/google WITH inviteCode but garbage token → 401 (gate passed, verifier ran)', async ({ request }) => {
    // When an inviteCode is present the gate passes; then the token verifier runs
    // and rejects the garbage token → 401.
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'fake-google-token', inviteCode: rootCode },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 closed mode
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('closed mode', () => {
  let adminTokens: TokenPair;
  let existingUser: { email: string; tokens: TokenPair };

  test.beforeAll(async ({ request }) => {
    // Ensure we start from open mode before creating users
    resetRegistrationModeToOpen();

    // Create an existing user BEFORE closing
    existingUser = await setupUser(request);

    // Create admin and close
    const admin = await setupUser(request, { role: 'admin' });
    adminTokens = admin.tokens;

    const patchRes = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'closed' },
      headers: authHeaders(adminTokens.accessToken),
    });
    expect(patchRes.status()).toBe(200);
  });

  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  // AC-INV-05
  test('AC-INV-05a — closed: POST /auth/register → 403', async ({ request }) => {
    const { status } = await registerRaw(request, randomEmail());
    expect(status).toBe(403);
  });

  test('AC-INV-05b — closed: POST /auth/register WITH inviteCode → still 403', async ({ request }) => {
    // Even with a code, closed mode blocks everything
    const { status } = await registerRaw(request, randomEmail(), {
      inviteCode: 'ANYRANDOMCODE',
    });
    expect(status).toBe(403);
  });

  test('AC-INV-05c — closed: POST /auth/google (new account) → 403 or 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'fake-token' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(201);
    expect([401, 403]).toContain(res.status());
  });

  // AC-INV-06
  test('AC-INV-06 — closed mode: existing user login still → 200', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: existingUser.email, password: VALID_PASSWORD },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'existing user login in closed mode must still work').toBe(200);
    const body = (await res.json()) as AuthResponse;
    expect(typeof body.tokens.accessToken).toBe('string');
  });

  test('AC-INV-06b — closed mode: existing user refresh still → 200', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/refresh`, {
      data: { refreshToken: existingUser.tokens.refreshToken },
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), 'refresh in closed mode must still work').toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 Full happy path — admin → root code → filleul registers → list + notif
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Full happy path — admin → root code → filleul registers', () => {
  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-INV-07 — admin sets invite_only, generates root code, filleul registers, list reflects accepted + notif', async ({
    request,
  }) => {
    // 1. Create & promote admin
    const admin = await setupUser(request, { role: 'admin' });

    // 2. Create an inviter (future parrain) — verified so they can later create invites
    const inviterEmail = randomEmail('parrain');
    const inviterAuth = await register(request, inviterEmail);
    const inviterId = inviterAuth.user.id;
    verifyEmailInDb(inviterId);
    const inviterTokens = (await login(request, inviterEmail)).tokens;

    // 3. Switch to invite_only
    const patchRes = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'invite_only' },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(patchRes.status(), 'PATCH mode to invite_only').toBe(200);
    const settingsBody = (await patchRes.json()) as { registrationMode: string };
    expect(settingsBody.registrationMode).toBe('invite_only');

    // 4. Generate one root invite
    const rootRes = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(rootRes.status(), 'POST /admin/invitations/root').toBe(201);
    const rootInvites = (await rootRes.json()) as Array<{ code: string; url: string }>;
    expect(rootInvites).toHaveLength(1);
    expect(typeof rootInvites[0]!.code).toBe('string');
    expect(rootInvites[0]!.code.length).toBeGreaterThanOrEqual(6);
    expect(rootInvites[0]!.url).toContain(rootInvites[0]!.code);
    const rootCode = rootInvites[0]!.code;

    // 5. Filleul registers with the root code (root has no inviter → no notif)
    const filleulEmail = randomEmail('filleul');
    const { status: regStatus, body: regBody } = await registerRaw(request, filleulEmail, {
      inviteCode: rootCode,
    });
    expect(regStatus, `filleul register: ${JSON.stringify(regBody)}`).toBe(201);
    const filleulAuth = regBody as AuthResponse;
    expect(filleulAuth.user).toBeTruthy();

    // 6. Inviter creates their own invitation (single_use). v2 shape: { id, code, url, kind }.
    const inv1Res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(inv1Res.status(), 'inviter POST /invitations').toBe(201);
    const inv1Body = (await inv1Res.json()) as {
      id: string;
      code: string;
      url: string;
      kind: string;
    };
    expect(typeof inv1Body.id).toBe('string');
    expect(typeof inv1Body.code).toBe('string');
    expect(inv1Body.url).toContain(inv1Body.code);
    expect(inv1Body.kind).toBe('single_use');

    // 7. GET /invitations (v2 shape) — no quota fields; the invite appears as pending.
    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(listRes.status(), 'GET /invitations for inviter').toBe(200);
    const listBody = (await listRes.json()) as {
      canBulkInvite: boolean;
      invites: Array<{
        id: string;
        code: string;
        url: string;
        kind: string;
        status: string;
        acceptedBy: unknown;
        signupsCount: number;
        createdAt: string;
      }>;
    };
    expect(typeof listBody.canBulkInvite).toBe('boolean');
    // No quota/used/available leakage in v2.
    expect('quota' in listBody).toBe(false);
    expect('used' in listBody).toBe(false);
    expect('available' in listBody).toBe(false);
    expect(Array.isArray(listBody.invites)).toBe(true);
    const inv1Listed = listBody.invites.find((i) => i.id === inv1Body.id);
    expect(inv1Listed, 'created invite must appear in list').toBeTruthy();
    expect(inv1Listed!.status).toBe('pending');
    expect(inv1Listed!.kind).toBe('single_use');
    expect(typeof inv1Listed!.signupsCount).toBe('number');

    // 8. A filleul2 registers using the inviter's own code → it becomes accepted.
    const filleul2Email = randomEmail('filleul2');
    const { status: f2Status, body: f2Body } = await registerRaw(request, filleul2Email, {
      inviteCode: inv1Body.code,
    });
    expect(f2Status, `filleul2 register with inviter code: ${JSON.stringify(f2Body)}`).toBe(201);
    const filleul2Auth = f2Body as AuthResponse;

    // 9. GET /invitations again — inv1 now accepted with acceptedBy populated.
    const listRes2 = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    const listBody2 = (await listRes2.json()) as {
      invites: Array<{
        id: string;
        status: string;
        acceptedBy: { id: string } | null;
        signupsCount: number;
      }>;
    };
    const inv1InList = listBody2.invites.find((i) => i.id === inv1Body.id);
    expect(inv1InList, 'inv1 must still appear in list').toBeTruthy();
    expect(inv1InList!.status).toBe('accepted');
    expect(inv1InList!.acceptedBy).toBeTruthy();
    expect(inv1InList!.acceptedBy!.id).toBe(filleul2Auth.user.id);
    // single_use signupsCount: exactly 1 real signup recorded via this invite.
    expect(inv1InList!.signupsCount).toBe(1);

    // 10. Inviter received an invite_accepted notification.
    const notifRes = await request.get(`${BASE_URL}/api/notifications`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(notifRes.status(), 'GET /notifications').toBe(200);
    const notifBody = (await notifRes.json()) as {
      items?: Array<{ type: string; [k: string]: unknown }>;
      notifications?: Array<{ type: string; [k: string]: unknown }>;
    };
    const items = notifBody.items ?? notifBody.notifications ?? [];
    const inviteAcceptedNotif = items.find((n) => n.type === 'invite_accepted');
    expect(inviteAcceptedNotif, 'inviter must have invite_accepted notification').toBeTruthy();

    // 11. Profile network: the inviter's profile exposes inviteesCount >= 1,
    //     and the filleul2 profile exposes invitedBy = the inviter.
    const inviterProfileRes = await request.get(`${BASE_URL}/api/profile/${inviterId}`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(inviterProfileRes.status(), 'GET /profile/:id (inviter)').toBe(200);
    const inviterProfile = (await inviterProfileRes.json()) as {
      user: { invitedBy: unknown; inviteesCount: number };
    };
    expect(typeof inviterProfile.user.inviteesCount).toBe('number');
    expect(inviterProfile.user.inviteesCount).toBeGreaterThanOrEqual(1);

    const filleul2ProfileRes = await request.get(
      `${BASE_URL}/api/profile/${filleul2Auth.user.id}`,
      { headers: authHeaders(inviterTokens.accessToken) },
    );
    expect(filleul2ProfileRes.status(), 'GET /profile/:id (filleul2)').toBe(200);
    const filleul2Profile = (await filleul2ProfileRes.json()) as {
      user: { invitedBy: { id: string } | null; inviteesCount: number };
    };
    expect(filleul2Profile.user.invitedBy, 'filleul2 must expose invitedBy').toBeTruthy();
    expect(filleul2Profile.user.invitedBy!.id).toBe(inviterId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 Unlimited invitations — no quota in v2
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Unlimited invitations (no quota)', () => {
  // Ensure open mode before registering users
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('unverified user cannot create invitation → 403 EMAIL_NOT_VERIFIED', async ({
    request,
  }) => {
    // Register but do NOT verify email
    const { user, tokens } = await register(request, randomEmail());
    void user;

    const res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'unverified must get 403').toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });

  test('verified user can create MANY invitations (no quota cap)', async ({ request }) => {
    const { userId, email } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);

    // Create well beyond the old v1 quota of 3 — all must succeed.
    const COUNT = 7;
    const createdIds: string[] = [];
    for (let i = 0; i < COUNT; i++) {
      const res = await request.post(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(tokens.accessToken),
      });
      expect(res.status(), `invite ${i + 1}/${COUNT} must succeed (no quota)`).toBe(201);
      const body = (await res.json()) as { id: string; kind: string };
      expect(body.kind).toBe('single_use');
      createdIds.push(body.id);
    }

    // List must show all of them, with no quota fields.
    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      canBulkInvite: boolean;
      invites: Array<{ id: string }>;
    };
    expect('quota' in listBody).toBe(false);
    expect('used' in listBody).toBe(false);
    expect('available' in listBody).toBe(false);
    expect(listBody.invites.length).toBeGreaterThanOrEqual(COUNT);
    for (const id of createdIds) {
      expect(listBody.invites.some((i) => i.id === id), `invite ${id} must be listed`).toBe(true);
    }

    revokeAllPendingInvitesInDb(userId);
  });

  test('revoke own pending invite → 204', async ({ request }) => {
    const { userId, email } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${id}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status(), 'revoke must return 204').toBe(204);

    revokeAllPendingInvitesInDb(userId);
  });

  test('revoke already-accepted invite → 409 Conflict', async ({ request }) => {
    const { email, userId } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id: invId } = (await createRes.json()) as { id: string };

    // Accept it directly in DB (simulates invite_only flow without switching mode)
    runSql(
      `UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_by_id = '${userId}' WHERE id = '${invId}';`,
    );

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${invId}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status(), 'revoking accepted invite must be 409').toBe(409);
  });

  test('revoke invite owned by another user → 404', async ({ request }) => {
    const owner = await setupUser(request, { verify: true });
    const other = await setupUser(request, { verify: true });

    const { tokens: ownerTokens } = await login(request, owner.email);
    const { tokens: otherTokens } = await login(request, other.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(ownerTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id: invId } = (await createRes.json()) as { id: string };

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${invId}/revoke`, {
      headers: authHeaders(otherTokens.accessToken),
    });
    expect(revokeRes.status(), 'other user revoking foreign invite must be 404').toBe(404);

    revokeAllPendingInvitesInDb(owner.userId);
  });

  test('POST /invitations without auth → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /invitations with unknown field → 400 (Zod strict)', async ({ request }) => {
    const { email } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { bogus: true },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'unknown field must be rejected by strict Zod').toBe(400);
  });

  test('POST /invitations with invalid kind → 400 (Zod enum)', async ({ request }) => {
    const { email } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'multi_use' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'invalid kind enum must be rejected by Zod').toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 Reusable mass-invite link (canBulkInvite)
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Reusable mass-invite link', () => {
  let adminTokens: TokenPair;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();
    const admin = await setupUser(request, { role: 'admin' });
    adminTokens = admin.tokens;
  });

  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('a user WITHOUT the right → POST { kind:reusable } → 403 BULK_INVITE_NOT_ALLOWED', async ({
    request,
  }) => {
    const { email } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);

    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'reusable without canBulkInvite must be 403').toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('BULK_INVITE_NOT_ALLOWED');

    // GET /invitations must report canBulkInvite=false for this user.
    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    const listBody = (await listRes.json()) as { canBulkInvite: boolean };
    expect(listBody.canBulkInvite).toBe(false);
  });

  test('admin grants canBulkInvite via PATCH /admin/users/:id/bulk-invite → user can create a reusable link', async ({
    request,
  }) => {
    const user = await setupUser(request, { verify: true });

    // Admin grants the right via the API.
    const grantRes = await request.patch(
      `${BASE_URL}/api/admin/users/${user.userId}/bulk-invite`,
      {
        data: { allowed: true },
        headers: authHeaders(adminTokens.accessToken),
      },
    );
    expect(grantRes.status(), 'admin grant bulk-invite → 200').toBe(200);
    const grantBody = (await grantRes.json()) as { id: string; canBulkInvite: boolean };
    expect(grantBody.id).toBe(user.userId);
    expect(grantBody.canBulkInvite).toBe(true);

    // Re-login is NOT required: canBulkInvite is read from DB at create time.
    const userTokens = (await login(request, user.email)).tokens;

    // GET /invitations must now report canBulkInvite=true.
    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(userTokens.accessToken),
    });
    const listBody = (await listRes.json()) as { canBulkInvite: boolean };
    expect(listBody.canBulkInvite, 'list must reflect granted right').toBe(true);

    // Create a reusable link.
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(userTokens.accessToken),
    });
    expect(res.status(), 'reusable creation with right → 201').toBe(201);
    const body = (await res.json()) as { id: string; code: string; url: string; kind: string };
    expect(body.kind).toBe('reusable');
    expect(body.url).toContain(body.code);

    revokeAllPendingInvitesInDb(user.userId);
  });

  test('reusable link → TWO different invite_only signups succeed with the SAME code; link stays valid and pending', async ({
    request,
  }) => {
    // 1. Grant the right via the DB helper (no admin call needed here).
    const inviter = await setupUser(request, { verify: true });
    setBulkInviteInDb(inviter.userId, true);
    const inviterTokens = (await login(request, inviter.email)).tokens;

    // 2. Create the reusable link.
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(createRes.status(), 'reusable creation → 201').toBe(201);
    const link = (await createRes.json()) as { id: string; code: string; kind: string };
    expect(link.kind).toBe('reusable');

    // 3. Switch to invite_only so the code gating is actually exercised.
    setRegistrationModeInDb('invite_only');

    try {
      // 4. First signup with the reusable code → 201.
      const f1Email = randomEmail('reuse1');
      const f1 = await registerRaw(request, f1Email, { inviteCode: link.code });
      expect(f1.status, `first reusable signup: ${JSON.stringify(f1.body)}`).toBe(201);
      const f1Auth = f1.body as AuthResponse;

      // 5. Second signup with the SAME code → also 201 (never consumed).
      const f2Email = randomEmail('reuse2');
      const f2 = await registerRaw(request, f2Email, { inviteCode: link.code });
      expect(f2.status, `second reusable signup must also succeed: ${JSON.stringify(f2.body)}`).toBe(201);
      const f2Auth = f2.body as AuthResponse;

      expect(f1Auth.user.id).not.toBe(f2Auth.user.id);

      // 6. The code must STILL be valid after both signups (reusable never consumed).
      const checkRes = await request.get(
        `${BASE_URL}/api/invitations/check?code=${link.code}`,
        { headers: { 'X-Forwarded-For': uniqueIp() } },
      );
      expect(checkRes.status()).toBe(200);
      const checkBody = (await checkRes.json()) as { valid: boolean; kind?: string };
      expect(checkBody.valid, 'reusable code must remain valid after signups').toBe(true);
      expect(checkBody.kind).toBe('reusable');

      // 7. The invitation row must still be 'pending' (active), never 'accepted'.
      const statusOut = runSql(`SELECT status FROM invitations WHERE id = '${link.id}';`);
      expect(statusOut, 'reusable link must stay pending after signups').toContain('pending');

      // 8. The list shows the link with signupsCount = 2 (two real signups via this link).
      const listRes = await request.get(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(inviterTokens.accessToken),
      });
      const listBody = (await listRes.json()) as {
        invites: Array<{ id: string; kind: string; status: string; signupsCount: number }>;
      };
      const linkRow = listBody.invites.find((i) => i.id === link.id);
      expect(linkRow, 'reusable link must appear in list').toBeTruthy();
      expect(linkRow!.kind).toBe('reusable');
      expect(linkRow!.status).toBe('pending');
      expect(linkRow!.signupsCount, 'two signups via reusable link').toBe(2);

      // 9. Both filleuls expose invitedBy = the inviter (parrain on profile).
      for (const filleul of [f1Auth, f2Auth]) {
        const profRes = await request.get(`${BASE_URL}/api/profile/${filleul.user.id}`, {
          headers: authHeaders(inviterTokens.accessToken),
        });
        expect(profRes.status()).toBe(200);
        const prof = (await profRes.json()) as {
          user: { invitedBy: { id: string } | null };
        };
        expect(prof.user.invitedBy, 'reusable filleul must expose invitedBy').toBeTruthy();
        expect(prof.user.invitedBy!.id).toBe(inviter.userId);
      }
    } finally {
      resetRegistrationModeToOpen();
      revokeAllPendingInvitesInDb(inviter.userId);
    }
  });

  test('revoking a reusable link stops it validating (check → valid:false)', async ({
    request,
  }) => {
    const inviter = await setupUser(request, { verify: true });
    setBulkInviteInDb(inviter.userId, true);
    const inviterTokens = (await login(request, inviter.email)).tokens;

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const link = (await createRes.json()) as { id: string; code: string };

    // Valid before revoke
    const before = await request.get(
      `${BASE_URL}/api/invitations/check?code=${link.code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(((await before.json()) as { valid: boolean }).valid).toBe(true);

    // Revoke
    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${link.id}/revoke`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(revokeRes.status(), 'revoke reusable → 204').toBe(204);

    // Invalid after revoke
    const after = await request.get(
      `${BASE_URL}/api/invitations/check?code=${link.code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(((await after.json()) as { valid: boolean }).valid, 'revoked reusable must not validate').toBe(false);
  });

  test('admin can revoke canBulkInvite (allowed:false) → reusable creation 403 again', async ({
    request,
  }) => {
    const user = await setupUser(request, { verify: true });
    setBulkInviteInDb(user.userId, true);

    // Revoke the right via API.
    const revokeRightRes = await request.patch(
      `${BASE_URL}/api/admin/users/${user.userId}/bulk-invite`,
      {
        data: { allowed: false },
        headers: authHeaders(adminTokens.accessToken),
      },
    );
    expect(revokeRightRes.status()).toBe(200);
    const body = (await revokeRightRes.json()) as { canBulkInvite: boolean };
    expect(body.canBulkInvite).toBe(false);

    const userTokens = (await login(request, user.email)).tokens;
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { kind: 'reusable' },
      headers: authHeaders(userTokens.accessToken),
    });
    expect(res.status(), 'reusable after right revoked → 403').toBe(403);
    const resBody = (await res.json()) as Record<string, unknown>;
    expect(resBody['code']).toBe('BULK_INVITE_NOT_ALLOWED');
  });

  test('non-admin cannot grant bulk-invite (PATCH /admin/users/:id/bulk-invite → 403)', async ({
    request,
  }) => {
    const actor = await setupUser(request, { verify: true });
    const target = await setupUser(request, { verify: true });
    const { tokens } = await login(request, actor.email);

    const res = await request.patch(
      `${BASE_URL}/api/admin/users/${target.userId}/bulk-invite`,
      {
        data: { allowed: true },
        headers: authHeaders(tokens.accessToken),
      },
    );
    expect(res.status(), 'normal user must not grant bulk-invite').toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 AuthZ — admin/moderator role gating
// ══════════════════════════════════════════════════════════════════════════════

test.describe('AuthZ — admin/moderator role gating', () => {
  // Ensure open mode before any user setup in this describe
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  // AC-INV-09
  test('AC-INV-09 — normal user PATCH /admin/settings → 403', async ({ request }) => {
    const { tokens } = await setupUser(request); // role=user by default
    const res = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'open' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'normal user must not access admin PATCH').toBe(403);
  });

  test('AC-INV-09b — moderator PATCH /admin/settings → 403 (admin-only)', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'moderator' });
    const res = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { registrationMode: 'open' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'moderator must not access admin-only PATCH').toBe(403);
  });

  // AC-INV-10
  test('AC-INV-10 — normal user POST /admin/invitations/root → 403', async ({ request }) => {
    const { tokens } = await setupUser(request);
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'normal user must not create root invites').toBe(403);
  });

  test('AC-INV-10b — moderator POST /admin/invitations/root → 403', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'moderator' });
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'moderator must not create root invites').toBe(403);
  });

  // AC-INV-11
  test('AC-INV-11a — moderator GET /admin/settings → 200', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'moderator' });
    const res = await request.get(`${BASE_URL}/api/admin/settings`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'moderator must read settings').toBe(200);
    const body = (await res.json()) as { registrationMode: string };
    expect(['open', 'invite_only', 'closed']).toContain(body.registrationMode);
  });

  test('AC-INV-11b — moderator GET /admin/invitations/metrics → 200', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'moderator' });
    const res = await request.get(`${BASE_URL}/api/admin/invitations/metrics`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'moderator must read invite metrics').toBe(200);
    const body = (await res.json()) as {
      sent: number;
      accepted: number;
      pending: number;
      conversionRate: number;
      kFactor: number;
      topInviters: unknown[];
    };
    expect(typeof body.sent).toBe('number');
    expect(typeof body.accepted).toBe('number');
    expect(typeof body.conversionRate).toBe('number');
    expect(typeof body.kFactor).toBe('number');
    expect(Array.isArray(body.topInviters)).toBe(true);
  });

  test('AC-INV-11c — admin GET /admin/settings → 200 (admin has access too)', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.get(`${BASE_URL}/api/admin/settings`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(200);
  });

  test('AC-INV-16 — GET /admin/settings without auth → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/settings`);
    expect(res.status()).toBe(401);
  });

  test('PATCH /admin/settings — empty body → 400 (at least one field required)', async ({
    request,
  }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: {},
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(400);
  });

  test('POST /admin/invitations/root — count=0 → 400 (min 1)', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 0 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(400);
  });

  test('POST /admin/invitations/root — count=201 → 400 (max 200)', async ({ request }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 201 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(400);
  });

  test('POST /admin/invitations/root — count=3 → 201, returns array of 3 codes', async ({
    request,
  }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 3 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as Array<{ code: string; url: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    body.forEach((inv, i) => {
      expect(typeof inv.code, `invite[${i}].code must be string`).toBe('string');
      expect(inv.code.length, `invite[${i}].code length`).toBeGreaterThanOrEqual(6);
      expect(inv.url, `invite[${i}].url must contain code`).toContain(inv.code);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 GET /admin/referrals — who-invited-whom
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('GET /admin/referrals — referral tree', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('non-admin/non-moderator → 403', async ({ request }) => {
    const { tokens } = await setupUser(request, { verify: true });
    const res = await request.get(`${BASE_URL}/api/admin/referrals`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'normal user must not read referrals').toBe(403);
  });

  test('admin lists referrals; a freshly-invited filleul appears with its inviter', async ({
    request,
  }) => {
    const admin = await setupUser(request, { role: 'admin' });

    // Create a verified inviter, who invites a filleul via invite_only.
    const inviter = await setupUser(request, { verify: true });
    const inviterTokens = (await login(request, inviter.email)).tokens;

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { code: string };

    setRegistrationModeInDb('invite_only');
    let filleulId: string;
    try {
      const filleulEmail = randomEmail('refchild');
      const reg = await registerRaw(request, filleulEmail, { inviteCode: inv.code });
      expect(reg.status, `filleul register: ${JSON.stringify(reg.body)}`).toBe(201);
      filleulId = (reg.body as AuthResponse).user.id;
    } finally {
      resetRegistrationModeToOpen();
    }

    // GET /admin/referrals — the filleul row must carry invitedBy = the inviter.
    const refRes = await request.get(`${BASE_URL}/api/admin/referrals?limit=100`, {
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(refRes.status(), 'admin GET /admin/referrals → 200').toBe(200);
    const refBody = (await refRes.json()) as {
      items: Array<{
        id: string;
        invitedBy: { id: string; displayName: string | null } | null;
        via: { kind: string } | null;
        inviteesCount: number;
      }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(refBody.items)).toBe(true);
    const row = refBody.items.find((r) => r.id === filleulId);
    expect(row, 'filleul must appear in the referral tree').toBeTruthy();
    expect(row!.invitedBy, 'referral row must expose its inviter').toBeTruthy();
    expect(row!.invitedBy!.id).toBe(inviter.userId);
    expect(row!.via?.kind).toBe('single_use');

    revokeAllPendingInvitesInDb(inviter.userId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §9 /invitations/check — v2: { valid, inviterName?, kind? }, no expiry
// ══════════════════════════════════════════════════════════════════════════════

test.describe('/invitations/check', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-INV-12 — invalid code → { valid:false }', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/invitations/check?code=INVALIDXXXXX`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { valid: boolean; inviterName?: string; kind?: string };
    expect(body.valid).toBe(false);
    expect(body.inviterName).toBeUndefined();
  });

  test('AC-INV-12b — missing code param → 400 (Zod)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invitations/check`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
  });

  test('AC-INV-13 — valid pending root code → { valid:true } (no inviter → no name)', async ({ request }) => {
    const admin = await setupUser(request, { role: 'admin' });
    const rootRes = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(rootRes.status()).toBe(201);
    const [rootInv] = (await rootRes.json()) as Array<{ code: string }>;

    const checkRes = await request.get(
      `${BASE_URL}/api/invitations/check?code=${rootInv!.code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(checkRes.status()).toBe(200);
    const body = (await checkRes.json()) as { valid: boolean; kind?: string };
    expect(body.valid).toBe(true);
    // Root invites are single_use.
    expect(body.kind).toBe('single_use');
  });

  test('AC-INV-13b — valid pending single_use code with real inviter → inviterName + kind present', async ({
    request,
  }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { code } = (await createRes.json()) as { code: string };

    const checkRes = await request.get(
      `${BASE_URL}/api/invitations/check?code=${code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(checkRes.status()).toBe(200);
    const body = (await checkRes.json()) as { valid: boolean; inviterName?: string; kind?: string };
    expect(body.valid).toBe(true);
    expect(typeof body.inviterName).toBe('string');
    expect((body.inviterName as string).length).toBeGreaterThan(0);
    expect(body.kind).toBe('single_use');

    revokeAllPendingInvitesInDb(inviter.userId);
  });

  test('code shorter than 6 chars → 400 (Zod min:6)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invitations/check?code=abc`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
  });

  test('code longer than 16 chars → 400 (Zod max:16)', async ({ request }) => {
    const longCode = 'A'.repeat(17);
    const res = await request.get(`${BASE_URL}/api/invitations/check?code=${longCode}`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(400);
  });

  test('accepted single_use code → { valid:false } (already consumed)', async ({ request }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id, code } = (await createRes.json()) as { id: string; code: string };

    runSql(
      `UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_by_id = '${inviter.userId}' WHERE id = '${id}';`,
    );

    const checkRes = await request.get(
      `${BASE_URL}/api/invitations/check?code=${code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(checkRes.status()).toBe(200);
    const body = (await checkRes.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  test('revoked code → { valid:false }', async ({ request }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    const { id, code } = (await createRes.json()) as { id: string; code: string };

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${id}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status()).toBe(204);

    const checkRes = await request.get(
      `${BASE_URL}/api/invitations/check?code=${code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    const body = (await checkRes.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §10 GET /invitations (list) — v2 shape + isolation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('GET /invitations (list)', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('unauthenticated → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invitations`);
    expect(res.status()).toBe(401);
  });

  test('unverified user → 403 EMAIL_NOT_VERIFIED', async ({ request }) => {
    const { tokens } = await register(request, randomEmail());
    const res = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });

  test('verified user with no invites → empty list + canBulkInvite:false (no quota fields)', async ({ request }) => {
    const { tokens } = await setupUser(request, { verify: true });
    const res = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      canBulkInvite: boolean;
      invites: unknown[];
    };
    expect(body.canBulkInvite).toBe(false);
    expect('quota' in body).toBe(false);
    expect('used' in body).toBe(false);
    expect('available' in body).toBe(false);
    expect(Array.isArray(body.invites)).toBe(true);
    expect(body.invites).toHaveLength(0);
  });

  test('returns only own invites (cross-user isolation)', async ({ request }) => {
    const u1 = await setupUser(request, { verify: true });
    const u2 = await setupUser(request, { verify: true });
    const t1 = (await login(request, u1.email)).tokens;
    const t2 = (await login(request, u2.email)).tokens;

    const r1 = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(t1.accessToken),
    });
    expect(r1.status()).toBe(201);
    const inv1 = (await r1.json()) as { id: string };

    const r2 = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(t2.accessToken),
    });
    const body2 = (await r2.json()) as { invites: Array<{ id: string }> };
    const leak = body2.invites.some((i) => i.id === inv1.id);
    expect(leak, 'u2 must not see u1 invite (IDOR)').toBe(false);

    revokeAllPendingInvitesInDb(u1.userId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §11 open mode regression — existing behaviour not broken
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('open mode — backward-compat regression', () => {
  test.beforeAll(async () => {
    resetRegistrationModeToOpen();
    await new Promise((r) => setTimeout(r, 200));
  });

  test('register without inviteCode in open mode → 201 (no regression)', async ({ request }) => {
    const { status } = await registerRaw(request, randomEmail());
    expect(status).toBe(201);
  });

  test('register WITH inviteCode in open mode → 201 (code ignored, not gated)', async ({
    request,
  }) => {
    const { status } = await registerRaw(request, randomEmail(), {
      inviteCode: 'IGNOREDCODE123',
    });
    expect(status).toBe(201);
  });
});
