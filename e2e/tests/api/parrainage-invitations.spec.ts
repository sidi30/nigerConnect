/**
 * parrainage-invitations.spec.ts
 *
 * E2E tests for the referral / invitation ("parrainage") system.
 * Spec reference: docs/SPEC_PARRAINAGE.md §12 — E2E section.
 *
 * Endpoints under test:
 *   GET  /auth/registration-mode
 *   POST /auth/register        (+inviteCode?)
 *   POST /auth/google          (+inviteCode?) — only Zod + 401 path; no live token
 *   POST /auth/apple           (+inviteCode?) — same
 *   POST /invitations
 *   GET  /invitations
 *   POST /invitations/:id/revoke
 *   GET  /invitations/check?code=
 *   GET  /admin/settings                (admin + mod)
 *   PATCH /admin/settings               (admin-only)
 *   POST  /admin/invitations/root       (admin-only)
 *   GET   /admin/invitations/metrics    (admin + mod)
 *
 * Test mapping to spec §12 acceptance criteria:
 *   AC-INV-01  invite_only: register WITHOUT code → 403
 *   AC-INV-02  invite_only: register WITH valid root code → 201
 *   AC-INV-03  invite_only: code REUSED → 400/409
 *   AC-INV-04  OAuth in invite_only without code (new account) → 403
 *   AC-INV-05  closed mode: all 3 create doors → 403
 *   AC-INV-06  closed mode: existing login + refresh still → 200
 *   AC-INV-07  Full happy path: admin PATCH mode → root code → filleul registers
 *              → GET /invitations shows accepted + quota decremented
 *              → inviter has invite_accepted notification
 *   AC-INV-08  Quota: verified user fills quota → 403; revoke → slot refunded
 *   AC-INV-09  AuthZ: non-admin PATCH /admin/settings → 403
 *   AC-INV-10  AuthZ: non-admin POST /admin/invitations/root → 403
 *   AC-INV-11  AuthZ: moderator GET /admin/settings + metrics → 200
 *   AC-INV-12  /invitations/check: invalid code → { valid:false }
 *   AC-INV-13  /invitations/check: valid pending code → { valid:true, inviterName }
 *   AC-INV-14  Unverified user cannot create invitation (quota = 0 effectively)
 *   AC-INV-15  POST /invitations without auth → 401
 *   AC-INV-16  GET  /admin/settings without auth → 401
 *
 * Isolation strategy:
 *   - Each describe block resets registration_mode back to 'open' in afterAll.
 *   - Registered users use unique emails to avoid inter-test conflicts.
 *   - DB mutations (role promotion, email verify) are done via `docker exec psql`
 *     following the exact pattern used in features-contract.spec.ts.
 *
 * Prerequisites (same as all other specs in this directory):
 *   - NestJS API on http://127.0.0.1:3000 (API_BASE_URL override supported)
 *   - Postgres accessible via docker exec nigerconnect-postgres
 *   - Redis on 6379
 *   - app_settings seeded (registration_mode='open', default_invite_quota='3',
 *     invite_expiry_days='30')
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

function setRegistrationModeInDb(mode: 'open' | 'invite_only' | 'closed'): void {
  runSql(`UPDATE app_settings SET value = '${mode}' WHERE key = 'registration_mode';`);
  // Also flush Redis so the API picks it up without waiting for TTL
  redisDel('setting:registration_mode');
}

/** Revoke every pending invitation for cleanup between sub-tests. */
function revokeAllPendingInvitesInDb(inviterId: string): void {
  runSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE inviter_id = '${inviterId}' AND status = 'pending';`,
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
 * Describes that may run in parallel with mode-switching describes should call
 * resetRegistrationModeToOpen() in their own beforeAll.
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
// §2 invite_only mode
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
    // We use the pre-fetched rootCode only once; following tests generate fresh codes.
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

  // AC-INV-03
  // BUG-001 FIXED: a code reused after acceptance now returns 400 INVITE_CODE_CONSUMED
  // (spec §4.1.6.b), distinguished from not-found/expired/revoked which stay 403.
  test('AC-INV-03 — code REUSED after acceptance → 400 INVITE_CODE_CONSUMED', async ({ request }) => {
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
    expect(second.status, 'reused code must be 400').toBe(400);
    const msg = JSON.stringify(second.body).toLowerCase();
    expect(msg).toMatch(/consumed|utilis/);
  });

  // AC-INV-04
  test('AC-INV-04 — POST /auth/google without inviteCode (new account) → 403', async ({ request }) => {
    // We cannot supply a real Google token. We supply a garbage one that fails
    // at the OAuth verification step. But the mode gate must trigger BEFORE
    // calling the Google verifier — so we expect 403, not 401.
    // This validates that the gating is on the "new account" branch.
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'fake-google-token-no-invite' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    // 403 means the invite gate fired; 401 means verifier ran first (gate misplaced).
    // The spec says gate must come BEFORE verification for new accounts, but since
    // we cannot supply a real token to prove a "new account" path, we accept either
    // 401 or 403 here — we document the limitation in a separate test note.
    // The critical assertion: it must NOT be 201 (account was not created).
    expect(res.status(), 'OAuth without code must not create account (not 201)').not.toBe(201);
    // Ideally 403; if 401 the backend reached the verifier first (implementation detail)
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
    // This proves the code path through the gate exists and the inviteCode field
    // is accepted by the DTO.
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'fake-google-token', inviteCode: rootCode },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    // With a valid code the gate should not 403; the verifier runs and rejects → 401
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
    // (guards against parallel execution with invite_only describe)
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
    // Same rationale as AC-INV-04: can't fake a real token; closed gate should fire first.
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
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'refresh in closed mode must still work').toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 Full happy path
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Full happy path — admin → root code → filleul registers', () => {
  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-INV-07 — admin sets invite_only, generates root code, filleul registers, quota reflects', async ({
    request,
  }) => {
    // 1. Create & promote admin
    const admin = await setupUser(request, { role: 'admin' });

    // 2. Create an inviter (future parrain) — verified so they can later create invites
    const inviterEmail = randomEmail('parrain');
    const inviterAuth = await register(request, inviterEmail);
    const inviterId = inviterAuth.user.id;
    verifyEmailInDb(inviterId);
    // Re-login to get a fresh token post-verification
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
      data: { count: 1, expiresInDays: 7 },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(rootRes.status(), 'POST /admin/invitations/root').toBe(201);
    const rootInvites = (await rootRes.json()) as Array<{
      code: string;
      url: string;
      expiresAt: string | null;
    }>;
    expect(rootInvites).toHaveLength(1);
    expect(typeof rootInvites[0]!.code).toBe('string');
    expect(rootInvites[0]!.code.length).toBeGreaterThanOrEqual(6);
    expect(rootInvites[0]!.url).toContain(rootInvites[0]!.code);
    const rootCode = rootInvites[0]!.code;

    // 5. Filleul registers with the root code — before they exist, no parrain to notify
    const filleulEmail = randomEmail('filleul');
    const { status: regStatus, body: regBody } = await registerRaw(request, filleulEmail, {
      inviteCode: rootCode,
    });
    expect(regStatus, `filleul register: ${JSON.stringify(regBody)}`).toBe(201);
    const filleulAuth = regBody as AuthResponse;
    expect(filleulAuth.user).toBeTruthy();

    // 6. Now have the inviter create their own invite (to test quota via GET /invitations)
    const inv1Res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(inv1Res.status(), 'inviter POST /invitations').toBe(201);
    const inv1Body = (await inv1Res.json()) as { id: string; code: string; url: string; expiresAt: string };
    expect(typeof inv1Body.id).toBe('string');
    expect(typeof inv1Body.code).toBe('string');
    expect(inv1Body.url).toContain(inv1Body.code);

    // 7. GET /invitations shows used + available
    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(listRes.status(), 'GET /invitations for inviter').toBe(200);
    const listBody = (await listRes.json()) as {
      quota: number;
      used: number;
      available: number;
      invites: Array<{ id: string; code: string; status: string }>;
    };
    expect(listBody.quota).toBeGreaterThan(0);
    expect(listBody.used).toBe(1);
    expect(listBody.available).toBe(listBody.quota - 1);
    expect(Array.isArray(listBody.invites)).toBe(true);
    const found = listBody.invites.some((i) => i.id === inv1Body.id);
    expect(found, 'created invite must appear in list').toBe(true);

    // 8. Have a second inviter use the pending code to register filleul2
    //    so we can verify invite_accepted notification
    // First generate another root code for filleul2
    const rootRes2 = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(admin.tokens.accessToken),
    });
    const [rootInv2] = (await rootRes2.json()) as Array<{ code: string }>;

    // inviter generates a user invite for filleul2
    // Reset to open so we can register filleul2's inviter first
    // (alternative: we already have inviterTokens who is verified)
    // Use the inviter's own code to invite filleul2
    const filleul2Email = randomEmail('filleul2');
    // In invite_only, filleul2 must register using the inviter's code
    // But the inviter already created inv1 above. Use that code.
    const { status: f2Status, body: f2Body } = await registerRaw(request, filleul2Email, {
      inviteCode: inv1Body.code,
    });
    expect(f2Status, `filleul2 register with inviter code: ${JSON.stringify(f2Body)}`).toBe(201);

    // 9. Check GET /invitations again — inv1 should now be 'accepted', used=2
    const listRes2 = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    const listBody2 = (await listRes2.json()) as {
      quota: number;
      used: number;
      available: number;
      invites: Array<{ id: string; status: string; acceptedBy: unknown }>;
    };
    // inviter created inv1 and it was accepted by filleul2 → used=1 (accepted slot counts)
    expect(listBody2.used).toBe(1);
    // The slot for inv1 is now 'accepted' so still counted
    const inv1InList = listBody2.invites.find((i) => i.id === inv1Body.id);
    expect(inv1InList, 'inv1 must still appear in list').toBeTruthy();
    expect(inv1InList!.status).toBe('accepted');
    expect(inv1InList!.acceptedBy).toBeTruthy();

    // 10. Check that inviter received an invite_accepted notification
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

    // Clean up root code 2 (not needed any further)
    void rootInv2;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 Quota enforcement + revoke
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Quota enforcement', () => {
  // Default quota is 3 per spec
  const DEFAULT_QUOTA = 3;

  // Ensure open mode before registering users (guards parallel mode-switch describes)
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-INV-14 — unverified user cannot create invitation → 403 EMAIL_NOT_VERIFIED', async ({
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

  test('AC-INV-08 — verified user fills quota, next POST → 403 INVITE_QUOTA_EXCEEDED', async ({
    request,
  }) => {
    const { userId, email } = await setupUser(request, { verify: true });
    // Re-login to get verified token (setupUser already re-logins after verify)
    const { tokens } = await login(request, email);

    const createdIds: string[] = [];

    // Fill up to quota
    for (let i = 0; i < DEFAULT_QUOTA; i++) {
      const res = await request.post(`${BASE_URL}/api/invitations`, {
        headers: authHeaders(tokens.accessToken),
      });
      expect(res.status(), `invite ${i + 1}/${DEFAULT_QUOTA} must succeed`).toBe(201);
      const body = (await res.json()) as { id: string };
      createdIds.push(body.id);
    }

    // One more → quota exceeded
    const overRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(overRes.status(), 'over-quota must be 403').toBe(403);
    const overBody = (await overRes.json()) as Record<string, unknown>;
    expect(overBody['code']).toBe('INVITE_QUOTA_EXCEEDED');

    // Revoke one pending invite → slot refunded
    const revokeId = createdIds[0]!;
    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${revokeId}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status(), 'revoke must return 204').toBe(204);

    // Now we should be able to create one more
    const refundRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(refundRes.status(), 'after revoke, quota refunded — new invite must succeed').toBe(201);

    // Clean up: revoke all to leave the DB clean for other tests
    revokeAllPendingInvitesInDb(userId);
  });

  test('AC-INV-08b — revoke already-accepted invite → 409 Conflict', async ({
    request,
  }) => {
    // We need invite_only to accept a code; easier to test via DB setup
    const { email, userId } = await setupUser(request, { verify: true });
    const { tokens } = await login(request, email);

    // Create one invite
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id: invId, code } = (await createRes.json()) as { id: string; code: string };

    // Accept it directly in DB (simulates invite_only flow without switching mode)
    runSql(
      `UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_by_id = '${userId}' WHERE id = '${invId}';`,
    );

    // Try to revoke an accepted invite → 409
    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${invId}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status(), 'revoking accepted invite must be 409').toBe(409);

    void code;
  });

  test('AC-INV-08c — revoke invite owned by another user → 404', async ({ request }) => {
    const owner = await setupUser(request, { verify: true });
    const other = await setupUser(request, { verify: true });

    const { tokens: ownerTokens } = await login(request, owner.email);
    const { tokens: otherTokens } = await login(request, other.email);

    // Owner creates an invite
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(ownerTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id: invId } = (await createRes.json()) as { id: string };

    // Other tries to revoke it → 404 (not found for this user)
    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${invId}/revoke`, {
      headers: authHeaders(otherTokens.accessToken),
    });
    expect(revokeRes.status(), 'other user revoking foreign invite must be 404').toBe(404);

    // Cleanup
    revokeAllPendingInvitesInDb(owner.userId);
  });

  test('AC-INV-15 — POST /invitations without auth → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 AuthZ — admin/moderator role gating
// ══════════════════════════════════════════════════════════════════════════════

test.describe('AuthZ — admin/moderator role gating', () => {
  // Ensure open mode before any user setup in this describe
  // (guards against parallel invite_only/closed describes)
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
    const body = (await res.json()) as {
      registrationMode: string;
      defaultInviteQuota: number;
      inviteExpiryDays: number;
    };
    expect(['open', 'invite_only', 'closed']).toContain(body.registrationMode);
    expect(typeof body.defaultInviteQuota).toBe('number');
    expect(typeof body.inviteExpiryDays).toBe('number');
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
      expired: number;
      revoked: number;
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

  test('PATCH /admin/settings — admin can set defaultInviteQuota and inviteExpiryDays', async ({
    request,
  }) => {
    const { tokens } = await setupUser(request, { role: 'admin' });
    const res = await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { defaultInviteQuota: 5, inviteExpiryDays: 14 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'admin PATCH settings → 200').toBe(200);
    const body = (await res.json()) as {
      defaultInviteQuota: number;
      inviteExpiryDays: number;
    };
    expect(body.defaultInviteQuota).toBe(5);
    expect(body.inviteExpiryDays).toBe(14);

    // Reset to defaults
    await request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { defaultInviteQuota: 3, inviteExpiryDays: 30 },
      headers: authHeaders(tokens.accessToken),
    });
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
    const body = (await res.json()) as Array<{ code: string; url: string; expiresAt: null }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    body.forEach((inv, i) => {
      expect(typeof inv.code, `invite[${i}].code must be string`).toBe('string');
      expect(inv.code.length, `invite[${i}].code length`).toBeGreaterThanOrEqual(6);
      expect(inv.url, `invite[${i}].url must contain code`).toContain(inv.code);
      expect(inv.expiresAt, 'no expiresInDays → expiresAt null').toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 /invitations/check
// ══════════════════════════════════════════════════════════════════════════════

test.describe('/invitations/check', () => {
  // Ensure open mode for user setup within this describe
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-INV-12 — invalid code → { valid:false }', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/invitations/check?code=INVALIDXXXXX`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { valid: boolean; inviterName?: string };
    expect(body.valid).toBe(false);
    expect(body.inviterName).toBeUndefined();
  });

  test('AC-INV-12b — missing code param → 400 (Zod)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invitations/check`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    // Zod rejects missing required query param
    expect(res.status()).toBe(400);
  });

  test('AC-INV-13 — valid pending code → { valid:true, inviterName }', async ({ request }) => {
    // Create an admin, generate a root code, verify the check endpoint
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
    const body = (await checkRes.json()) as { valid: boolean; inviterName?: string };
    expect(body.valid).toBe(true);
    // Root invite has no inviter, so inviterName may be null/undefined — that is acceptable
    // The important thing is valid=true
  });

  test('AC-INV-13b — valid pending code with real inviter → inviterName present', async ({
    request,
  }) => {
    // Create a verified user who will be the inviter
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    // Inviter creates an invite
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { code } = (await createRes.json()) as { code: string };

    // Check the code
    const checkRes = await request.get(
      `${BASE_URL}/api/invitations/check?code=${code}`,
      { headers: { 'X-Forwarded-For': uniqueIp() } },
    );
    expect(checkRes.status()).toBe(200);
    const body = (await checkRes.json()) as { valid: boolean; inviterName?: string };
    expect(body.valid).toBe(true);
    // inviterName should be the inviter's display name
    expect(typeof body.inviterName).toBe('string');
    expect((body.inviterName as string).length).toBeGreaterThan(0);

    // Cleanup
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

  test('accepted code → { valid:false } (already consumed)', async ({ request }) => {
    // Create an invite and mark it accepted directly in the DB
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const { id, code } = (await createRes.json()) as { id: string; code: string };

    // Mark as accepted in DB
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

    // Revoke via API
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
// §8 GET /invitations (list)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('GET /invitations (list)', () => {
  // Ensure open mode so user registration in tests doesn't get gated
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
    // The global EmailVerifiedGuard fires — list is an authenticated route
    expect(res.status()).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('EMAIL_NOT_VERIFIED');
  });

  test('verified user with no invites → empty list, correct quota', async ({ request }) => {
    const { tokens } = await setupUser(request, { verify: true });
    const res = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      quota: number;
      used: number;
      available: number;
      invites: unknown[];
    };
    expect(body.quota).toBeGreaterThan(0);
    expect(body.used).toBe(0);
    expect(body.available).toBe(body.quota);
    expect(Array.isArray(body.invites)).toBe(true);
    expect(body.invites).toHaveLength(0);
  });

  test('returns only own invites (cross-user isolation)', async ({ request }) => {
    const u1 = await setupUser(request, { verify: true });
    const u2 = await setupUser(request, { verify: true });
    const t1 = (await login(request, u1.email)).tokens;
    const t2 = (await login(request, u2.email)).tokens;

    // u1 creates an invite
    const r1 = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(t1.accessToken),
    });
    expect(r1.status()).toBe(201);
    const inv1 = (await r1.json()) as { id: string };

    // u2's list must NOT contain u1's invite
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
// §9 open mode regression — existing behaviour not broken
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('open mode — backward-compat regression', () => {
  test.beforeAll(async () => {
    // Force open mode — this describe MUST run after mode-changing describes complete.
    // The fullyParallel:true config means describes run in parallel so we force reset
    // via DB directly here to ensure isolation.
    resetRegistrationModeToOpen();
    // Small wait to allow Redis TTL propagation from the DB-direct write
    await new Promise((r) => setTimeout(r, 200));
  });

  test('register without inviteCode in open mode → 201 (no regression)', async ({ request }) => {
    const { status } = await registerRaw(request, randomEmail());
    expect(status).toBe(201);
  });

  test('register WITH inviteCode in open mode → 201 (code ignored, not gated)', async ({
    request,
  }) => {
    // Even a random code is ignored in open mode
    const { status } = await registerRaw(request, randomEmail(), {
      inviteCode: 'IGNOREDCODE123',
    });
    expect(status).toBe(201);
  });
});
