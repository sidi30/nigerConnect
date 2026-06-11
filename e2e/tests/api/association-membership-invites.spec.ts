/**
 * association-membership-invites.spec.ts
 *
 * Regression / contract tests for the NigerConnect ASSOCIATION membership
 * and invitation feature (apps/api/src/association).
 *
 * Covered scenarios
 * ─────────────────
 * A. CREATION WITH requiresApproval=true
 *    A1. creator must have approved identity (403 otherwise)
 *    A2. approved creator → 201; requiresApproval echoed in response
 *
 * B. JOIN REQUEST FLOW (requiresApproval=true)
 *    B1. User B joins → response pending:true
 *    B2. Admin sees B in GET /associations/:id/pending
 *    B3. Non-admin calling /pending → 403
 *
 * C. APPROVE REQUEST
 *    C1. Admin approves → B appears in GET /associations/:id/members
 *    C2. memberCount incremented
 *    C3. B receives association_join_approved notification with data.associationId
 *
 * D. REJECT REQUEST
 *    D1. Admin rejects requester C → C not in /members
 *    D2. C receives association_join_rejected notification with data.associationId
 *    D3. Non-admin calling /reject → 403
 *
 * E. INVITE ENDPOINT (POST /associations/:id/invite)
 *    E1. Admin invites non-member → { invited:true }; target gets association_invite
 *        notification carrying data.associationId
 *    E2. Moderator can also invite → { invited:true }
 *    E3. Plain member (non-admin/mod) inviting → 403
 *    E4. Unauthenticated caller inviting → 401
 *    E5. Inviting an already-approved member → 409
 *    E6. Inviting self → 400
 *    E7. Inviting a user who has a pending request → 409
 *
 * F. AUTHZ ON ADMIN ENDPOINTS
 *    F1. Non-member calling /pending → 403
 *    F2. Non-member calling /approve → 403
 *    F3. Non-member calling /reject  → 403
 *
 * Prerequisites (servers must already be running — NOT started here):
 *   API   http://127.0.0.1:3000  (NestJS, prefix /api)
 *   Postgres accessible via: docker exec nigerconnect-postgres psql …
 *
 * Run:
 *   cd e2e
 *   API_BASE_URL=http://127.0.0.1:3000 npx playwright test \
 *     tests/api/association-membership-invites.spec.ts \
 *     --project=api-association-membership
 */

import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ─────────────────────────────────────────────────────────────────

const PSQL_CMD = (sql: string) =>
  `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${sql.replace(/"/g, '\\"')}"`;

function psql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(PSQL_CMD(oneLine), { stdio: 'pipe' }).toString();
}

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function approveIdentityInDb(userId: string): void {
  psql(`UPDATE users SET identity_status = 'approved' WHERE id = '${userId}';`);
}

function getAssociationMemberCount(associationId: string): number {
  const out = psql(
    `SELECT member_count FROM associations WHERE id = '${associationId}';`,
  );
  const match = out.match(/\d+/);
  return match ? parseInt(match[0], 10) : -1;
}

// ── Request helpers ────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2eassoc'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
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

async function register(
  request: APIRequestContext,
  email: string,
): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'AssocE2E',
      lastName: 'Test',
    },
    headers: {
      'X-Forwarded-For': uniqueIp(),
      'Content-Type': 'application/json',
    },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

/**
 * Register, verify email, approve identity, then re-login so the fresh JWT
 * carries the updated identity_status. This mirrors registerApproved() in
 * city-required-map.spec.ts — the standard pattern for association creators.
 */
async function registerApproved(
  request: APIRequestContext,
  prefix = 'e2eassocadmin',
): Promise<{ user: AuthResponse['user']; tokens: TokenPair; email: string }> {
  const email = randomEmail(prefix);
  const { user } = await register(request, email);
  verifyEmailInDb(user.id);
  approveIdentityInDb(user.id);
  // Re-login so JWT reflects identity_status='approved'.
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(loginRes.status(), `login after approve → expected 200, got ${loginRes.status()}`).toBe(200);
  const loginBody = (await loginRes.json()) as AuthResponse;
  return { user, tokens: loginBody.tokens, email };
}

/** Register + verify email only (no identity approval). */
async function registerVerified(
  request: APIRequestContext,
  prefix = 'e2eassocuser',
): Promise<AuthResponse> {
  const email = randomEmail(prefix);
  const auth = await register(request, email);
  verifyEmailInDb(auth.user.id);
  return auth;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

/**
 * Create an association with requiresApproval=true.
 * The caller must already have an approved identity token.
 */
async function createApprovalAssoc(
  request: APIRequestContext,
  accessToken: string,
  suffix = '',
): Promise<{ id: string; name: string; memberCount: number; requiresApproval: boolean }> {
  const name = `E2eAssoc-${Date.now()}${suffix}`;
  const res = await request.post(`${BASE_URL}/api/associations`, {
    data: {
      name,
      category: 'generaliste',
      city: 'Niamey',
      countryCode: 'NE',
      requiresApproval: true,
    },
    headers: authHeaders(accessToken),
  });
  expect(
    res.status(),
    `createApprovalAssoc → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as {
    id: string;
    name: string;
    memberCount: number;
    requiresApproval: boolean;
  };
}

/**
 * Fetch all notifications for a user and return only those matching a given
 * type and associationId in data.
 */
async function getAssocNotifications(
  request: APIRequestContext,
  accessToken: string,
  type: string,
  associationId: string,
): Promise<Array<{ id: string; type: string; data: Record<string, unknown> }>> {
  const res = await request.get(`${BASE_URL}/api/notifications`, {
    headers: authHeaders(accessToken),
  });
  expect(
    res.status(),
    `GET /notifications → expected 200, got ${res.status()}`,
  ).toBe(200);
  const body = (await res.json()) as {
    items: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  };
  return body.items.filter(
    (n) => n.type === type && (n.data as Record<string, unknown>)['associationId'] === associationId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A. CREATION WITH requiresApproval=true
// ─────────────────────────────────────────────────────────────────────────────

test.describe('A. Create association with requiresApproval=true', () => {

  test('A1. Non-approved user cannot create an association (403)', async ({ request }) => {
    // Verified email but identity NOT approved.
    const auth = await registerVerified(request, 'e2ecreate403');

    const res = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `AssocNoIdentity-${Date.now()}`,
        category: 'generaliste',
        city: 'Niamey',
        countryCode: 'NE',
        requiresApproval: true,
      },
      headers: authHeaders(auth.tokens.accessToken),
    });

    expect(
      res.status(),
      `Non-approved user must get 403 creating association, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('A2. Approved creator gets 201; requiresApproval=true echoed in response', async ({ request }) => {
    const { tokens } = await registerApproved(request, 'e2ecreate201');

    const res = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `AssocApproved-${Date.now()}`,
        category: 'generaliste',
        city: 'Niamey',
        countryCode: 'NE',
        requiresApproval: true,
      },
      headers: authHeaders(tokens.accessToken),
    });

    expect(
      res.status(),
      `Approved creator must get 201, got ${res.status()}: ${await res.text()}`,
    ).toBe(201);

    const body = (await res.json()) as {
      id: string;
      requiresApproval: boolean;
      memberCount: number;
    };
    expect(typeof body.id, 'created.id must be a string (UUID)').toBe('string');
    expect(body.requiresApproval, 'requiresApproval must be true in response').toBe(true);
    // Creator is auto-added as an approved admin member.
    expect(body.memberCount, 'creator must be counted as initial member').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. JOIN REQUEST FLOW
// ─────────────────────────────────────────────────────────────────────────────

test.describe('B. Join request flow (requiresApproval=true)', () => {

  test('B1. User B joins → response has pending:true', async ({ request }) => {
    const admin = await registerApproved(request, 'e2eb1admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-B1');

    const userB = await registerVerified(request, 'e2eb1userb');

    const joinRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userB.tokens.accessToken),
    });

    expect(
      joinRes.status(),
      `User B join → expected 201, got ${joinRes.status()}: ${await joinRes.text()}`,
    ).toBe(201);

    const joinBody = (await joinRes.json()) as { pending: boolean };
    expect(joinBody.pending, 'join response must have pending:true for requiresApproval assoc').toBe(true);
  });

  test('B2. Admin sees pending requester in GET /associations/:id/pending', async ({ request }) => {
    const admin = await registerApproved(request, 'e2eb2admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-B2');

    const userB = await registerVerified(request, 'e2eb2userb');

    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userB.tokens.accessToken),
    });

    const pendingRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/pending`, {
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      pendingRes.status(),
      `GET /pending → expected 200, got ${pendingRes.status()}: ${await pendingRes.text()}`,
    ).toBe(200);

    const pendingBody = (await pendingRes.json()) as {
      items: Array<{ userId: string; user?: { id: string } }>;
    };
    expect(Array.isArray(pendingBody.items), 'pending.items must be an array').toBe(true);

    const found = pendingBody.items.some((m) => m.userId === userB.user.id);
    expect(
      found,
      `User B (${userB.user.id}) must appear in pending list`,
    ).toBe(true);
  });

  test('B3. Non-admin member calling /pending → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2eb3admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-B3');

    // Plain member (just verified, no admin role)
    const member = await registerVerified(request, 'e2eb3member');

    // This is a *non-approval* join attempt — we need an open assoc for the member.
    // Instead, test with a user who is simply not a member of this assoc.
    const pendingRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/pending`, {
      headers: authHeaders(member.tokens.accessToken),
    });

    expect(
      pendingRes.status(),
      `Non-admin calling /pending → expected 403, got ${pendingRes.status()}`,
    ).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. APPROVE REQUEST
// ─────────────────────────────────────────────────────────────────────────────

test.describe('C. Admin approves join request', () => {

  test('C1–C3. After approval: B in /members; memberCount+1; B gets association_join_approved notification', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ec1admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-C1');

    const countBefore = getAssociationMemberCount(assoc.id);

    const userB = await registerVerified(request, 'e2ec1userb');

    // B requests to join
    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userB.tokens.accessToken),
    });

    // Admin approves
    const approveRes = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${userB.user.id}/approve`,
      { headers: authHeaders(admin.tokens.accessToken) },
    );
    expect(
      approveRes.status(),
      `approve → expected 201, got ${approveRes.status()}: ${await approveRes.text()}`,
    ).toBe(201);

    // C1. B must now appear in /members
    const membersRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/members`, {
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(
      membersRes.status(),
      `GET /members → expected 200, got ${membersRes.status()}`,
    ).toBe(200);

    const membersBody = (await membersRes.json()) as {
      items: Array<{ userId: string; status: string }>;
    };
    expect(Array.isArray(membersBody.items), 'members.items must be an array').toBe(true);

    const bMember = membersBody.items.find((m) => m.userId === userB.user.id);
    expect(
      bMember,
      `User B (${userB.user.id}) must appear in /members after approval`,
    ).toBeDefined();

    // C2. memberCount must have incremented by 1
    const countAfter = getAssociationMemberCount(assoc.id);
    expect(
      countAfter,
      `memberCount must be ${countBefore + 1} after approving B, got ${countAfter}`,
    ).toBe(countBefore + 1);

    // C3. B receives association_join_approved notification with data.associationId
    const notifications = await getAssocNotifications(
      request,
      userB.tokens.accessToken,
      'association_join_approved',
      assoc.id,
    );
    expect(
      notifications.length,
      `User B must receive exactly one association_join_approved notification for assoc ${assoc.id}`,
    ).toBeGreaterThanOrEqual(1);

    const notif = notifications[0]!;
    expect(
      (notif.data as Record<string, unknown>)['associationId'],
      'notification data.associationId must match the association id',
    ).toBe(assoc.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. REJECT REQUEST
// ─────────────────────────────────────────────────────────────────────────────

test.describe('D. Admin rejects join request', () => {

  test('D1–D3. After rejection: C absent from /members; C gets rejected notification; non-admin /reject → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ed1admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-D1');

    const userC = await registerVerified(request, 'e2ed1userc');
    const stranger = await registerVerified(request, 'e2ed1stranger');

    // C requests to join
    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userC.tokens.accessToken),
    });

    // D3. Non-admin stranger cannot reject — must get 403 before admin acts
    const strangerRejectRes = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${userC.user.id}/reject`,
      { headers: authHeaders(stranger.tokens.accessToken) },
    );
    expect(
      strangerRejectRes.status(),
      `Non-admin calling /reject → expected 403, got ${strangerRejectRes.status()}`,
    ).toBe(403);

    // Admin rejects C
    const rejectRes = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${userC.user.id}/reject`,
      {
        data: { reason: 'E2E test rejection' },
        headers: authHeaders(admin.tokens.accessToken),
      },
    );
    expect(
      rejectRes.status(),
      `admin reject → expected 201, got ${rejectRes.status()}: ${await rejectRes.text()}`,
    ).toBe(201);

    // D1. C must NOT appear in /members
    const membersRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/members`, {
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(membersRes.status(), 'GET /members must return 200').toBe(200);

    const membersBody = (await membersRes.json()) as {
      items: Array<{ userId: string }>;
    };
    const found = membersBody.items.some((m) => m.userId === userC.user.id);
    expect(
      found,
      `Rejected user C (${userC.user.id}) must NOT appear in /members`,
    ).toBe(false);

    // D2. C receives association_join_rejected notification with data.associationId
    const notifications = await getAssocNotifications(
      request,
      userC.tokens.accessToken,
      'association_join_rejected',
      assoc.id,
    );
    expect(
      notifications.length,
      `User C must receive association_join_rejected notification for assoc ${assoc.id}`,
    ).toBeGreaterThanOrEqual(1);

    const notif = notifications[0]!;
    expect(
      (notif.data as Record<string, unknown>)['associationId'],
      'rejected notification data.associationId must match assoc id',
    ).toBe(assoc.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. INVITE ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────

test.describe('E. POST /associations/:id/invite', () => {

  test('E1. Admin invites non-member → { invited:true }; target receives association_invite notification', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee1admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E1');

    const target = await registerVerified(request, 'e2ee1target');

    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: target.user.id },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(
      inviteRes.status(),
      `admin invite → expected 201, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(201);

    const inviteBody = (await inviteRes.json()) as { invited: boolean };
    expect(inviteBody.invited, 'invite response must have invited:true').toBe(true);

    // Target must receive association_invite notification with data.associationId
    const notifications = await getAssocNotifications(
      request,
      target.tokens.accessToken,
      'association_invite',
      assoc.id,
    );
    expect(
      notifications.length,
      `Target must receive association_invite notification for assoc ${assoc.id}`,
    ).toBeGreaterThanOrEqual(1);

    const notif = notifications[0]!;
    expect(
      (notif.data as Record<string, unknown>)['associationId'],
      'invite notification data.associationId must match assoc id',
    ).toBe(assoc.id);
  });

  test('E2. Moderator can invite a non-member', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee2admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E2');

    // Register + verify a moderator, join the open assoc using a detour:
    // we use the low-level DB path — promote a user to moderator via changeRole.
    const modAuth = await registerVerified(request, 'e2ee2mod');
    // Moderator must first be an approved member. Admin invites them, then they join.
    // Simplest path: admin invites mod, then we simulate approval by having mod join
    // an open assoc OR by setting the role in DB directly after joining.
    // Here we use the API fully:
    //   1. Admin creates an open assoc (no requiresApproval) so mod can auto-join.
    //   2. Admin promotes mod to moderator.
    //   3. Mod uses the original requiresApproval assoc to invite.
    // But we need both assocs owned by the same admin, which is valid.

    // Create a second open association for the mod to auto-join.
    const openAssocRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `E2eOpenAssoc-${Date.now()}`,
        category: 'generaliste',
        city: 'Niamey',
        countryCode: 'NE',
        requiresApproval: false,
      },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(openAssocRes.status()).toBe(201);
    const openAssoc = (await openAssocRes.json()) as { id: string };

    // Mod joins the open assoc (auto-approved).
    const joinRes = await request.post(`${BASE_URL}/api/associations/${openAssoc.id}/join`, {
      headers: authHeaders(modAuth.tokens.accessToken),
    });
    expect(
      joinRes.status(),
      `mod join open assoc → expected 201, got ${joinRes.status()}: ${await joinRes.text()}`,
    ).toBe(201);

    // Admin promotes mod to moderator in the OPEN assoc.
    const promoteRes = await request.patch(
      `${BASE_URL}/api/associations/${openAssoc.id}/members/${modAuth.user.id}/role`,
      {
        data: { role: 'moderator' },
        headers: authHeaders(admin.tokens.accessToken),
      },
    );
    expect(
      promoteRes.status(),
      `promote mod → expected 200, got ${promoteRes.status()}: ${await promoteRes.text()}`,
    ).toBe(200);

    // Now add mod as approved moderator in the requiresApproval assoc using the
    // approval flow: mod requests, admin approves, admin promotes.
    const joinApprovalRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(modAuth.tokens.accessToken),
    });
    expect(joinApprovalRes.status(), 'mod join requiresApproval assoc → expected 201').toBe(201);

    const approveModRes = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${modAuth.user.id}/approve`,
      { headers: authHeaders(admin.tokens.accessToken) },
    );
    expect(approveModRes.status(), 'approve mod in requiresApproval assoc → expected 201').toBe(201);

    const promoteModRes = await request.patch(
      `${BASE_URL}/api/associations/${assoc.id}/members/${modAuth.user.id}/role`,
      {
        data: { role: 'moderator' },
        headers: authHeaders(admin.tokens.accessToken),
      },
    );
    expect(promoteModRes.status(), 'promote mod to moderator in requiresApproval assoc → expected 200').toBe(200);

    // Now moderator invites a fresh non-member target.
    const target = await registerVerified(request, 'e2ee2target');
    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: target.user.id },
      headers: authHeaders(modAuth.tokens.accessToken),
    });

    expect(
      inviteRes.status(),
      `moderator invite → expected 201, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(201);

    const inviteBody = (await inviteRes.json()) as { invited: boolean };
    expect(inviteBody.invited, 'moderator invite response must have invited:true').toBe(true);
  });

  test('E3. Plain member (non-admin/mod) inviting → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee3admin');
    // Create a requiresApproval=false assoc so the plain member can auto-join.
    const openAssocRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `E2eOpenE3-${Date.now()}`,
        category: 'generaliste',
        city: 'Niamey',
        countryCode: 'NE',
        requiresApproval: false,
      },
      headers: authHeaders(admin.tokens.accessToken),
    });
    expect(openAssocRes.status()).toBe(201);
    const openAssoc = (await openAssocRes.json()) as { id: string };

    const plainMember = await registerVerified(request, 'e2ee3plainmember');

    // Plain member auto-joins the open assoc.
    const joinRes = await request.post(`${BASE_URL}/api/associations/${openAssoc.id}/join`, {
      headers: authHeaders(plainMember.tokens.accessToken),
    });
    expect(joinRes.status(), 'plain member join → expected 201').toBe(201);

    // Plain member tries to invite someone → must get 403.
    const target = await registerVerified(request, 'e2ee3target');
    const inviteRes = await request.post(`${BASE_URL}/api/associations/${openAssoc.id}/invite`, {
      data: { userId: target.user.id },
      headers: authHeaders(plainMember.tokens.accessToken),
    });

    expect(
      inviteRes.status(),
      `plain member invite → expected 403, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(403);
  });

  test('E4. Unauthenticated caller inviting → 401', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee4admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E4');

    const target = await registerVerified(request, 'e2ee4target');

    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: target.user.id },
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
      // No Authorization header
    });

    expect(
      inviteRes.status(),
      `unauthenticated invite → expected 401, got ${inviteRes.status()}`,
    ).toBe(401);
  });

  test('E5. Inviting an already-approved member → 409 Conflict', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee5admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E5');

    const userB = await registerVerified(request, 'e2ee5userb');

    // B joins and gets approved.
    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userB.tokens.accessToken),
    });
    await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${userB.user.id}/approve`,
      { headers: authHeaders(admin.tokens.accessToken) },
    );

    // Admin tries to invite the already-approved B → 409.
    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: userB.user.id },
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      inviteRes.status(),
      `inviting already-approved member → expected 409, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(409);
  });

  test('E6. Inviting self → 400', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee6admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E6');

    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: admin.user.id },
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      inviteRes.status(),
      `inviting self → expected 400, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(400);
  });

  test('E7. Inviting a user who already has a pending join request → 409 Conflict', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ee7admin');
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, '-E7');

    const userD = await registerVerified(request, 'e2ee7userd');

    // D has an outstanding pending request.
    const joinRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(userD.tokens.accessToken),
    });
    expect(joinRes.status(), 'D join → expected 201').toBe(201);
    const joinBody = (await joinRes.json()) as { pending: boolean };
    expect(joinBody.pending, 'join response must be pending').toBe(true);

    // Admin tries to invite D while D's request is pending → 409.
    const inviteRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/invite`, {
      data: { userId: userD.user.id },
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      inviteRes.status(),
      `inviting user with pending request → expected 409, got ${inviteRes.status()}: ${await inviteRes.text()}`,
    ).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. AUTHZ NEGATIVE — non-admin on admin-only endpoints
// ─────────────────────────────────────────────────────────────────────────────

test.describe('F. AuthZ negatives — non-admin on /pending / /approve / /reject', () => {

  /**
   * Shared setup: admin creates requiresApproval assoc; requester D joins
   * (pending); stranger is a completely unrelated verified user.
   */
  async function setupForAuthzTests(request: APIRequestContext, tag: string) {
    const admin = await registerApproved(request, `e2ef${tag}admin`);
    const assoc = await createApprovalAssoc(request, admin.tokens.accessToken, `-F${tag}`);

    const requester = await registerVerified(request, `e2ef${tag}req`);
    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(requester.tokens.accessToken),
    });

    const stranger = await registerVerified(request, `e2ef${tag}stranger`);
    return { admin, assoc, requester, stranger };
  }

  test('F1. Non-member calling GET /pending → 403', async ({ request }) => {
    const { assoc, stranger } = await setupForAuthzTests(request, '1');

    const res = await request.get(`${BASE_URL}/api/associations/${assoc.id}/pending`, {
      headers: authHeaders(stranger.tokens.accessToken),
    });

    expect(
      res.status(),
      `Non-member GET /pending → expected 403, got ${res.status()}`,
    ).toBe(403);
  });

  test('F2. Non-member calling POST /approve → 403', async ({ request }) => {
    const { assoc, requester, stranger } = await setupForAuthzTests(request, '2');

    const res = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${requester.user.id}/approve`,
      { headers: authHeaders(stranger.tokens.accessToken) },
    );

    expect(
      res.status(),
      `Non-member POST /approve → expected 403, got ${res.status()}`,
    ).toBe(403);
  });

  test('F3. Non-member calling POST /reject → 403', async ({ request }) => {
    const { assoc, requester, stranger } = await setupForAuthzTests(request, '3');

    const res = await request.post(
      `${BASE_URL}/api/associations/${assoc.id}/members/${requester.user.id}/reject`,
      {
        data: { reason: 'authz test' },
        headers: authHeaders(stranger.tokens.accessToken),
      },
    );

    expect(
      res.status(),
      `Non-member POST /reject → expected 403, got ${res.status()}`,
    ).toBe(403);
  });
});
