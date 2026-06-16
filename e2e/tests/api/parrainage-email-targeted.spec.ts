/**
 * parrainage-email-targeted.spec.ts
 *
 * E2E tests for the EMAIL-TARGETED invitation path — contract v2 "réseau".
 * Spec reference: docs/SPEC_PARRAINAGE_V2_RESEAU.md
 *
 * Backend contract under test (v2):
 *   POST /invitations accepts optional { email, kind? }
 *     → kind defaults to 'single_use'; with an email it stores targetEmail
 *       (pending only) + sends an invite email (fire-and-forget).
 *     → email is IGNORED when kind=reusable (a shareable link has no recipient).
 *   Registration in invite_only — all 3 doors — succeeds when:
 *     (a) valid inviteCode provided  (single_use OR reusable)
 *     (b) new account email === a pending single_use invitation's targetEmail
 *   Code takes precedence over email-match when both are applicable.
 *   targetEmail is purged (null) on accept / revoke.
 *   NO quota (unlimited invites). NO expiration.
 *
 * Acceptance criteria tracked here:
 *   AC-EM-01  invite_only: POST /invitations { email: X } → 201 with code; register email=X, no code → 201
 *   AC-EM-02  invite_only: register with email that has NO pending invite, no code → 403
 *   AC-EM-03  Precedence: code wins over email-match; email-X invite stays pending
 *   AC-EM-04  Single-use via email-match: second registration with same email → 400/403; targetEmail purged
 *   AC-EM-05  open mode: email-match does NOT run; targeted invite is NOT silently consumed
 *   AC-EM-06  OAuth email-match: in invite_only, OAuth whose email === targetEmail, no code → NOT a 403 invite rejection
 *   AC-EM-07  Unlimited: many email invites succeed (no quota), reusable ignores email
 *
 * Prerequisites (same as parrainage-invitations.spec.ts):
 *   - NestJS API on http://127.0.0.1:3000 (API_BASE_URL override supported)
 *   - Postgres accessible (DATABASE_URL in CI, docker exec locally)
 *   - Redis on 6379 (REDIS_URL in CI, docker exec locally)
 *   - app_settings seeded (registration_mode='open')
 *
 * Isolation:
 *   - All describes that mutate registration_mode are marked .serial.
 *   - afterAll always resets mode to 'open'.
 *   - Each test uses unique emails via randomEmail() to avoid inter-test conflicts.
 *   - Runs with workers:1 + fullyParallel:false in CI (see playwright.config.ts).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql, redisDel } from './_db-exec';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ─────────────────────────────────────────────────────────────────

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
  redisDel('setting:registration_mode');
}

function resetRegistrationModeToOpen(): void {
  setRegistrationModeInDb('open');
}

/**
 * Read the target_email column from the invitations table for a given invitation id.
 * Returns the string value or null if purged.
 */
function getTargetEmailFromDb(invitationId: string): string | null {
  const out = runSql(
    `SELECT target_email FROM invitations WHERE id = '${invitationId}';`,
  );
  // psql aligned output:
  //  target_email
  // --------------
  //  foo@bar.com
  // (1 row)
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const valueLine = lines[2];
  if (!valueLine || valueLine === '(1 row)') return null;
  if (valueLine === '') return null;
  return valueLine;
}

function revokeAllPendingInvitesInDb(inviterId: string): void {
  runSql(
    `UPDATE invitations SET status = 'revoked', revoked_at = now(), target_email = null WHERE inviter_id = '${inviterId}' AND status = 'pending';`,
  );
  redisDel('setting:registration_mode');
}

// ── Request helpers ────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

function randomEmail(prefix = 'e2eem'): string {
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

async function registerRaw(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'EmE2E',
      lastName: 'Test',
      ...extra,
    },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  return { status: res.status(), body: await res.json() };
}

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

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

/**
 * Register + verify email + optional role promotion + re-login.
 * Mode must be 'open' before calling (callers set it in beforeAll).
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

  const { tokens } = await login(request, email);
  return { userId, email, tokens };
}

/**
 * Switch mode to invite_only via DB (fastest, avoids needing an admin token
 * during beforeAll setup where mode may still be unknown).
 */
function switchToInviteOnly(): void {
  setRegistrationModeInDb('invite_only');
}

// ══════════════════════════════════════════════════════════════════════════════
// §1 AC-EM-01 — email-targeted invite + email-match registration
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-01 — email-targeted invite → email-match registration', () => {
  let inviterTokens: TokenPair;
  let inviterId: string;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupUser(request, { verify: true });
    inviterId = inviter.userId;
    inviterTokens = inviter.tokens;
    switchToInviteOnly();
  });

  test.afterAll(() => {
    revokeAllPendingInvitesInDb(inviterId);
    resetRegistrationModeToOpen();
  });

  test('AC-EM-01a — POST /invitations { email: X } returns 201 with { id, code, url, kind:single_use }', async ({ request }) => {
    const targetEmail = randomEmail('target');

    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });

    expect(res.status(), 'POST /invitations with email must return 201').toBe(201);
    const body = (await res.json()) as { id: string; code: string; url: string; kind: string };
    expect(typeof body.id).toBe('string');
    expect(typeof body.code).toBe('string');
    expect(body.code.length).toBeGreaterThanOrEqual(6);
    expect(body.url).toContain(body.code);
    expect(body.kind, 'email invite defaults to single_use').toBe('single_use');
    // Confirm targetEmail was stored in DB (pending — not yet purged)
    const stored = getTargetEmailFromDb(body.id);
    expect(stored, 'targetEmail must be stored in DB while pending').toBe(targetEmail.toLowerCase());
  });

  test('AC-EM-01b — register new account with email=targetEmail, no inviteCode → 201 (email-match)', async ({
    request,
  }) => {
    const targetEmail = randomEmail('emailmatch');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string; code: string };

    const { status, body } = await registerRaw(request, targetEmail);
    expect(
      status,
      `email-match registration must succeed (201), got ${status}: ${JSON.stringify(body)}`,
    ).toBe(201);
    const auth = body as AuthResponse;
    expect(auth.user).toBeTruthy();
    expect(typeof auth.tokens.accessToken).toBe('string');

    // targetEmail must be purged from the invitation after acceptance
    const purged = getTargetEmailFromDb(inv.id);
    expect(purged, 'targetEmail must be null after email-match acceptance').toBeNull();

    // The new account must expose invitedBy = the inviter (network parrain).
    const profRes = await request.get(`${BASE_URL}/api/profile/${auth.user.id}`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(profRes.status()).toBe(200);
    const prof = (await profRes.json()) as { user: { invitedBy: { id: string } | null } };
    expect(prof.user.invitedBy, 'email-match filleul must expose invitedBy').toBeTruthy();
    expect(prof.user.invitedBy!.id).toBe(inviterId);
  });

  test('AC-EM-01c — response shape is { id, code, url, kind } (no quota/expiresAt)', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: randomEmail('shape') },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(typeof body['code']).toBe('string');
    expect(typeof body['url']).toBe('string');
    expect(typeof body['kind']).toBe('string');
    // v2: no expiry, no quota leakage in the create response.
    expect('expiresAt' in body).toBe(false);
    expect('quota' in body).toBe(false);
  });

  test('AC-EM-01d — GET /invitations lists the email-targeted invite as pending (v2 shape)', async ({ request }) => {
    const targetEmail = randomEmail('listed');

    await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });

    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      canBulkInvite: boolean;
      invites: Array<{ status: string; kind: string }>;
    };
    expect(typeof listBody.canBulkInvite).toBe('boolean');
    expect('quota' in listBody).toBe(false);
    const hasPendingSingle = listBody.invites.some(
      (i) => i.status === 'pending' && i.kind === 'single_use',
    );
    expect(hasPendingSingle, 'at least one pending single_use invite must appear in list').toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 AC-EM-02 — email-match negative: no pending invite for email → 403
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-02 — email-match negative: no pending invite for email → 403', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
    switchToInviteOnly();
  });

  test.afterAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-EM-02 — register with untargeted email, no code → 403 INVITE_CODE_REQUIRED', async ({
    request,
  }) => {
    const orphanEmail = randomEmail('orphan');

    const { status, body } = await registerRaw(request, orphanEmail);
    expect(
      status,
      `untargeted email without code must be 403, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(403);
    const b = body as Record<string, unknown>;
    const msg = JSON.stringify(b).toLowerCase();
    expect(msg).toMatch(/invitation|invite|code/);
  });

  test('AC-EM-02b — register with email of a REVOKED targeted invite → 403', async ({
    request,
  }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupUser(request, { verify: true });
    switchToInviteOnly();

    const targetEmail = randomEmail('revoked-target');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviter.tokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string };

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${inv.id}/revoke`, {
      headers: authHeaders(inviter.tokens.accessToken),
    });
    expect(revokeRes.status()).toBe(204);

    const { status, body } = await registerRaw(request, targetEmail);
    expect(
      status,
      `revoked targeted invite must not allow email-match, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(403);

    const purged = getTargetEmailFromDb(inv.id);
    expect(purged, 'targetEmail must be null after revoke').toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 AC-EM-03 — Code takes precedence over email-match
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-03 — Precedence: code wins over email-match; email-X invite stays pending', () => {
  let adminTokens: TokenPair;
  let inviterTokens: TokenPair;
  let inviterId: string;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();

    const admin = await setupUser(request, { role: 'admin' });
    adminTokens = admin.tokens;

    const inviter = await setupUser(request, { verify: true });
    inviterId = inviter.userId;
    inviterTokens = inviter.tokens;

    switchToInviteOnly();
  });

  test.afterAll(() => {
    revokeAllPendingInvitesInDb(inviterId);
    resetRegistrationModeToOpen();
  });

  test('AC-EM-03 — register with email=Y but valid code for a DIFFERENT invite → 201 via code; email-X invite stays pending', async ({
    request,
  }) => {
    const emailX = randomEmail('target-x');
    const emailY = randomEmail('registrant-y');

    const invXRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: emailX },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invXRes.status()).toBe(201);
    const invX = (await invXRes.json()) as { id: string; code: string };

    const rootRes = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(adminTokens.accessToken),
    });
    expect(rootRes.status()).toBe(201);
    const [rootInv] = (await rootRes.json()) as Array<{ code: string }>;

    const { status, body } = await registerRaw(request, emailY, {
      inviteCode: rootInv!.code,
    });
    expect(
      status,
      `registration via code must succeed for emailY, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(201);

    const invXRowStatus = runSql(
      `SELECT status FROM invitations WHERE id = '${invX.id}';`,
    );
    expect(
      invXRowStatus,
      'email-X targeted invite must remain pending after emailY registered via code',
    ).toContain('pending');

    const storedTarget = getTargetEmailFromDb(invX.id);
    expect(
      storedTarget,
      'targetEmail for invX must not be purged (invite was not consumed)',
    ).toBe(emailX.toLowerCase());
  });

  test('AC-EM-03b — same registration email as targetEmail BUT code supplied → code wins, targeted invite stays pending', async ({
    request,
  }) => {
    const emailZ = randomEmail('z-code-wins');

    const invZRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: emailZ },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invZRes.status()).toBe(201);
    const invZ = (await invZRes.json()) as { id: string; code: string };

    const rootRes = await request.post(`${BASE_URL}/api/admin/invitations/root`, {
      data: { count: 1 },
      headers: authHeaders(adminTokens.accessToken),
    });
    const [rootCode] = (await rootRes.json()) as Array<{ code: string }>;

    const { status, body } = await registerRaw(request, emailZ, {
      inviteCode: rootCode!.code,
    });
    expect(
      status,
      `emailZ must register via the supplied code, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(201);

    const invZStatus = runSql(
      `SELECT status FROM invitations WHERE id = '${invZ.id}';`,
    );
    expect(
      invZStatus,
      'email-targeted invite must remain pending when code path was used',
    ).toContain('pending');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 AC-EM-04 — Single-use: second registration with same email → rejected;
//               targetEmail purged after first acceptance
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-04 — Single-use email-match', () => {
  let inviterTokens: TokenPair;
  let inviterId: string;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupUser(request, { verify: true });
    inviterId = inviter.userId;
    inviterTokens = inviter.tokens;
    switchToInviteOnly();
  });

  test.afterAll(() => {
    revokeAllPendingInvitesInDb(inviterId);
    resetRegistrationModeToOpen();
  });

  test('AC-EM-04a — second registration with same email → rejected (invite consumed)', async ({
    request,
  }) => {
    const targetEmail = randomEmail('singleuse');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string };

    const first = await registerRaw(request, targetEmail);
    expect(
      first.status,
      `first email-match registration must succeed, got ${first.status}: ${JSON.stringify(first.body)}`,
    ).toBe(201);

    expect(getTargetEmailFromDb(inv.id), 'targetEmail must be purged after first accept').toBeNull();

    // Second attempt with the same email: either 403 (invite gate, no pending
    // invite remains) or 409 (email conflict). MUST NOT be 201.
    const second = await registerRaw(request, targetEmail);
    expect(
      second.status,
      `second registration with same email must be rejected, got ${second.status}: ${JSON.stringify(second.body)}`,
    ).not.toBe(201);
    expect(
      [403, 409],
      `second registration must be 403 (invite gate) or 409 (email conflict), got ${second.status}`,
    ).toContain(second.status);
  });

  test('AC-EM-04b — using the code from a consumed email-match invite → 400 INVITE_CODE_CONSUMED', async ({
    request,
  }) => {
    const targetEmail = randomEmail('consumed-code');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string; code: string };

    const first = await registerRaw(request, targetEmail);
    expect(first.status, 'email-match registration must succeed').toBe(201);

    const { status, body } = await registerRaw(request, randomEmail('codereuse'), {
      inviteCode: inv.code,
    });
    expect(
      status,
      `reusing the code from a consumed email-match invite must be 400, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(400);
    const msg = JSON.stringify(body).toLowerCase();
    expect(msg).toMatch(/consumed|utilis/);
  });

  test('AC-EM-04c — GET /invitations shows consumed invite as accepted with acceptedBy + signupsCount 1', async ({ request }) => {
    const targetEmail = randomEmail('accepted-list');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string };

    const reg = await registerRaw(request, targetEmail);
    expect(reg.status).toBe(201);

    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      invites: Array<{ id: string; status: string; acceptedBy: unknown; signupsCount: number }>;
    };
    const found = listBody.invites.find((i) => i.id === inv.id);
    expect(found, 'consumed invite must appear in list').toBeTruthy();
    expect(found!.status, 'consumed invite must be accepted').toBe('accepted');
    expect(found!.acceptedBy, 'acceptedBy must be populated').toBeTruthy();
    expect(found!.signupsCount, 'single_use signupsCount = 1').toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 AC-EM-05 — open mode: email-match logic does NOT run
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-05 — open mode: email-match does not run; targeted invite untouched', () => {
  let inviterTokens: TokenPair;
  let inviterId: string;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupUser(request, { verify: true });
    inviterId = inviter.userId;
    inviterTokens = inviter.tokens;
    // Keep mode open — do NOT switch to invite_only
  });

  test.afterAll(() => {
    revokeAllPendingInvitesInDb(inviterId);
    resetRegistrationModeToOpen();
  });

  test('AC-EM-05a — open mode: register with a targeted email + no code → 201; invite stays pending', async ({
    request,
  }) => {
    const targetEmail = randomEmail('open-target');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);
    const inv = (await invRes.json()) as { id: string };

    const { status, body } = await registerRaw(request, targetEmail);
    expect(
      status,
      `open mode: registration must succeed without any code, got ${status}: ${JSON.stringify(body)}`,
    ).toBe(201);

    const invStatus = runSql(
      `SELECT status FROM invitations WHERE id = '${inv.id}';`,
    );
    expect(
      invStatus,
      'targeted invite must remain pending after open-mode registration',
    ).toContain('pending');

    const storedTarget = getTargetEmailFromDb(inv.id);
    expect(
      storedTarget,
      'targetEmail must NOT be purged in open mode (invite was not consumed)',
    ).toBe(targetEmail.toLowerCase());
  });

  test('AC-EM-05b — open mode: register with email not targeted by any invite → 201 (trivially)', async ({
    request,
  }) => {
    const { status } = await registerRaw(request, randomEmail('open-plain'));
    expect(status, 'plain registration in open mode must be 201').toBe(201);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 AC-EM-06 — OAuth email-match in invite_only: NOT a 403 invite rejection
// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('AC-EM-06 — OAuth email-match in invite_only: gate passes (not 403)', () => {
  let inviterTokens: TokenPair;
  let inviterId: string;

  test.beforeAll(async ({ request }) => {
    resetRegistrationModeToOpen();
    const inviter = await setupUser(request, { verify: true });
    inviterId = inviter.userId;
    inviterTokens = inviter.tokens;
    switchToInviteOnly();
  });

  test.afterAll(() => {
    revokeAllPendingInvitesInDb(inviterId);
    resetRegistrationModeToOpen();
  });

  /**
   * We cannot supply a real Google/Apple JWT in E2E tests. The OAuth verifier
   * runs before the creation branch / invite gate, so a garbage token returns 401.
   * CRITICAL: the response must NOT be a 403 invite rejection and must NOT create
   * an account. This proves the OAuth path does not pre-emptively 403 an email
   * that has a pending targeted invite.
   */
  test('AC-EM-06a — Google OAuth with garbage token, pending invite for that email → 401 (not 403)', async ({
    request,
  }) => {
    const targetEmail = randomEmail('oauth-google');

    const invRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });
    expect(invRes.status()).toBe(201);

    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'garbage-oauth-token-for-email-match-test' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });

    expect(res.status(), 'OAuth with garbage token must not create account').not.toBe(201);
    expect(res.status()).toBe(401);
  });

  test('AC-EM-06b — Apple OAuth with garbage token, pending invite for that email → 401', async ({
    request,
  }) => {
    const targetEmail = randomEmail('oauth-apple');

    await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(inviterTokens.accessToken),
    });

    const res = await request.post(`${BASE_URL}/api/auth/apple`, {
      data: { identityToken: 'garbage-apple-token-email-match' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });

    expect(res.status(), 'Apple OAuth with garbage token must not create account').not.toBe(201);
    expect(res.status()).toBe(401);
  });

  test('AC-EM-06c — Google OAuth WITHOUT pending invite for that email in invite_only → 401 (verifier first)', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/auth/google`, {
      data: { idToken: 'garbage-oauth-no-invite' },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });

    expect(res.status(), 'untargeted email with garbage token → must not be 201').not.toBe(201);
    expect([401, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 AC-EM-07 — Unlimited: no quota; reusable ignores the email field
// ══════════════════════════════════════════════════════════════════════════════

test.describe('AC-EM-07 — Unlimited email invites (no quota) + reusable ignores email', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('AC-EM-07a — many email invites succeed (no quota cap)', async ({
    request,
  }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    // Well beyond the old v1 quota of 3 — all must succeed in v2.
    const COUNT = 6;
    for (let i = 0; i < COUNT; i++) {
      const res = await request.post(`${BASE_URL}/api/invitations`, {
        data: { email: randomEmail(`bulk${i}`) },
        headers: authHeaders(tokens.accessToken),
      });
      expect(res.status(), `email invite ${i + 1}/${COUNT} must succeed (no quota)`).toBe(201);
    }

    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      canBulkInvite: boolean;
      invites: Array<{ kind: string }>;
    };
    expect('quota' in listBody).toBe(false);
    expect('used' in listBody).toBe(false);
    expect(listBody.invites.length).toBeGreaterThanOrEqual(COUNT);

    revokeAllPendingInvitesInDb(inviter.userId);
  });

  test('AC-EM-07b — reusable link ignores the email field; no targetEmail stored', async ({
    request,
  }) => {
    const inviter = await setupUser(request, { verify: true });
    // Grant the reusable right directly in DB.
    runSql(`UPDATE users SET can_bulk_invite = true WHERE id = '${inviter.userId}';`);
    const { tokens } = await login(request, inviter.email);

    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: randomEmail('ignored'), kind: 'reusable' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'reusable creation → 201').toBe(201);
    const body = (await res.json()) as { id: string; kind: string };
    expect(body.kind).toBe('reusable');
    // targetEmail must NOT be stored for a reusable link, even though email was sent.
    expect(getTargetEmailFromDb(body.id), 'reusable link must not store targetEmail').toBeNull();

    revokeAllPendingInvitesInDb(inviter.userId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 Supplementary: data-minimization + Zod validation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Data-minimization: targetEmail purged on all non-pending transitions', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('targetEmail is null in DB after revoke', async ({ request }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const targetEmail = randomEmail('purge-revoke');
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const inv = (await createRes.json()) as { id: string };

    expect(getTargetEmailFromDb(inv.id)).toBe(targetEmail.toLowerCase());

    const revokeRes = await request.post(`${BASE_URL}/api/invitations/${inv.id}/revoke`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(revokeRes.status()).toBe(204);

    expect(getTargetEmailFromDb(inv.id), 'targetEmail purged after revoke').toBeNull();
  });

  test('POST /invitations without email body → 201, targetEmail is null in DB', async ({
    request,
  }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const inv = (await createRes.json()) as { id: string };

    expect(getTargetEmailFromDb(inv.id), 'no email in body → targetEmail must be null').toBeNull();

    revokeAllPendingInvitesInDb(inviter.userId);
  });

  test('POST /invitations with invalid email format → 400 (Zod)', async ({ request }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: 'notanemail' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'invalid email format must be rejected with 400').toBe(400);
  });

  test('POST /invitations with email too long (>254) → 400 (Zod)', async ({ request }) => {
    const inviter = await setupUser(request, { verify: true });
    const { tokens } = await login(request, inviter.email);

    const longEmail = `${'a'.repeat(250)}@b.com`;
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: longEmail },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), 'email longer than 254 chars must be rejected with 400').toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §9 GET /invitations — cross-user isolation (IDOR)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('GET /invitations — cross-user isolation', () => {
  test.beforeAll(() => {
    resetRegistrationModeToOpen();
  });

  test('Another user cannot see the owner invite (IDOR)', async ({ request }) => {
    const owner = await setupUser(request, { verify: true });
    const other = await setupUser(request, { verify: true });
    const ownerTokens = (await login(request, owner.email)).tokens;
    const otherTokens = (await login(request, other.email)).tokens;

    const targetEmail = randomEmail('isolation');
    const createRes = await request.post(`${BASE_URL}/api/invitations`, {
      data: { email: targetEmail },
      headers: authHeaders(ownerTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const inv = (await createRes.json()) as { id: string };

    const listRes = await request.get(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(otherTokens.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      invites: Array<{ id: string }>;
    };
    const leak = listBody.invites.some((i) => i.id === inv.id);
    expect(leak, 'other user must not see owner invite (IDOR)').toBe(false);

    revokeAllPendingInvitesInDb(owner.userId);
  });
});
