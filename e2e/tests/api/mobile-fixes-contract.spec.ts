/**
 * Mobile-fixes contract tests
 *
 * Verifies the API endpoints that the four mobile bug fixes depend on:
 *
 *   Bug 1 — Friend button on map   → friends relationship + request endpoints
 *   Bug 4 — Association detail     → association CRUD, members, join/leave
 *   Bug 3 — Comment live deletion  → post creation, comment CRUD, commentCount
 *
 * Each test describe block creates isolated users via the same pattern as
 * session-lifecycle.spec.ts: unique email, unique X-Forwarded-For IP to
 * stay within the per-IP rate limit (3 register/min).
 *
 * Association tests require identityStatus='approved' on the creator.  The
 * API only sets this through the admin identity-review endpoint (which itself
 * needs an admin user + a pending identity document).  Instead we update the
 * DB directly via psql, which is safe in a local test environment and keeps
 * tests deterministic without wiring up a full identity-review flow.
 *
 * Prerequisites:
 *   API_BASE_URL=http://127.0.0.1:3000  (localhost resolves to ::1 on Windows)
 *   Postgres accessible at localhost:5433 (nigerconnect/nigerconnect/nigerconnect)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

// ── Shared constants ─────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** RFC-1918 private address in 10.x.x.x range, unique per call. */
function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

/** Unique email per call — timestamp + random suffix avoids collisions. */
function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2emobile+${ts}${rand}@nigerconnect.test`;
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
    data: { email, password: VALID_PASSWORD, firstName: 'MobileE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`).toBe(201);
  return (await res.json()) as AuthResponse;
}

/** Approve identity status directly via psql (avoids full identity-review flow). */
function approveIdentityInDb(userId: string): void {
  psql(`UPDATE users SET identity_status = 'approved' WHERE id = '${userId}';`);
}

/**
 * Mark a user's email as verified directly in the DB.
 * Required because the EmailVerifiedGuard blocks all authenticated routes
 * (except @AllowUnverified ones) until email_verified=true.
 * Column is `email_verified` (mapped from Prisma field `emailVerified`).
 */
function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

// ── Bug 1: Friend button on map — relationship + request endpoints ─────────

test.describe('Friends (bug 1 — map friend button)', () => {
  test('GET /api/friends/relationship/:userId → "none" between two fresh users', async ({ request }) => {
    const emailA = randomEmail();
    const emailB = randomEmail();
    const { user: userA, tokens: tokensA } = await register(request, emailA);
    const { user: userB } = await register(request, emailB);
    verifyEmailInDb(userA.id);
    verifyEmailInDb(userB.id);

    const res = await request.get(`${BASE_URL}/api/friends/relationship/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { status: string; friendshipId: string | null };
    expect(body.status).toBe('none');
    expect(body.friendshipId).toBeNull();
    // suppress unused variable warning
    void userA;
  });

  test('POST /api/friends/request/:userId → 201/200, outgoing then incoming', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await register(request, randomEmail());
    const { user: userB, tokens: tokensB } = await register(request, randomEmail());
    verifyEmailInDb(userA.id);
    verifyEmailInDb(userB.id);

    // A sends request to B
    const sendRes = await request.post(`${BASE_URL}/api/friends/request/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    expect([200, 201]).toContain(sendRes.status());

    // Relationship from A's perspective → outgoing
    const relA = await request.get(`${BASE_URL}/api/friends/relationship/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    expect(relA.status()).toBe(200);
    const bodyA = await relA.json() as { status: string };
    expect(bodyA.status).toBe('outgoing');

    // Relationship from B's perspective → incoming
    const relB = await request.get(`${BASE_URL}/api/friends/relationship/${userA.id}`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}` },
    });
    expect(relB.status()).toBe(200);
    const bodyB = await relB.json() as { status: string };
    expect(bodyB.status).toBe('incoming');
  });

  test('POST /api/friends/request duplicate → 4xx, not 500', async ({ request }) => {
    const { user: userB } = await register(request, randomEmail());
    const { user: userA, tokens: tokensA } = await register(request, randomEmail());
    verifyEmailInDb(userB.id);
    verifyEmailInDb(userA.id);

    // First request
    await request.post(`${BASE_URL}/api/friends/request/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });

    // Duplicate request — must return a 4xx error, not 500
    const dupRes = await request.post(`${BASE_URL}/api/friends/request/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    const status = dupRes.status();
    expect(status, `duplicate friend request should be 4xx, got ${status}`).toBeGreaterThanOrEqual(400);
    expect(status, `duplicate friend request should be 4xx, got ${status}`).toBeLessThan(500);
  });

  test('POST /api/friends/request to self → 400', async ({ request }) => {
    const { user, tokens } = await register(request, randomEmail());
    verifyEmailInDb(user.id);
    const res = await request.post(`${BASE_URL}/api/friends/request/${user.id}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status()).toBe(400);
  });
});

// ── Bug 4: Association detail route ─────────────────────────────────────────

test.describe('Associations (bug 4 — detail route)', () => {
  /** Create a user with approved identity and verified email, return their auth tokens + id. */
  async function registerApproved(request: APIRequestContext) {
    const email = randomEmail();
    const { user, tokens } = await register(request, email);
    verifyEmailInDb(user.id);
    approveIdentityInDb(user.id);
    // Re-login so the JWT carries the up-to-date identity status (the token
    // issued at register time still has identityStatus=not_submitted; the API
    // re-reads DB on every request so this is only relevant if the guard checks
    // the JWT claim rather than the DB — currently it checks the DB, so the
    // original token is fine.  We keep the re-login for defensive correctness.)
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email, password: VALID_PASSWORD },
      headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
    });
    expect(loginRes.status()).toBe(200);
    const loginBody = await loginRes.json() as AuthResponse;
    return { user, tokens: loginBody.tokens };
  }

  test('POST /api/associations → 201 with id; GET /api/associations/:id → 200 with expected fields', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `TestAssoc-${Date.now()}`,
        description: 'E2E test association',
        category: 'culture',
        countryCode: 'NE',
        city: 'Niamey',
      },
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(createRes.status(), `create association: ${await createRes.text()}`).toBe(201);
    const assoc = await createRes.json() as { id: string; name: string; description: string; city: string; countryCode: string; memberCount: number };
    expect(typeof assoc.id).toBe('string');

    // GET detail
    const getRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(getRes.status()).toBe(200);
    const detail = await getRes.json() as Record<string, unknown>;
    expect(detail['id']).toBe(assoc.id);
    expect(typeof detail['name']).toBe('string');
    // city and countryCode are fields the mobile detail screen expects
    expect(detail['city']).toBe('Niamey');
    expect(detail['countryCode']).toBe('NE');
    // memberCount should exist (creator is automatically a member)
    expect(typeof detail['memberCount']).toBe('number');
    expect(detail['memberCount'] as number).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/associations/:id/members → 200, creator is in the list', async ({ request }) => {
    const { user, tokens } = await registerApproved(request);

    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `TestAssoc-members-${Date.now()}`,
        category: 'etudiants',
        countryCode: 'NE',
        city: 'Niamey',
      },
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(createRes.status()).toBe(201);
    const assoc = await createRes.json() as { id: string };

    // The members endpoint requires authentication (global JwtAuthGuard).
    const membersRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/members`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(membersRes.status()).toBe(200);
    const body = await membersRes.json() as { items: Array<{ user: { id: string } }> };
    expect(Array.isArray(body.items)).toBe(true);
    const creatorInList = body.items.some((m) => m.user.id === user.id);
    expect(creatorInList, 'creator must appear in members list').toBe(true);
  });

  test('GET /api/associations/:id with unknown UUID → 404', async ({ request }) => {
    // All endpoints are auth-guarded. We need a valid token to reach the 404 branch.
    const { user, tokens } = await register(request, randomEmail());
    verifyEmailInDb(user.id);
    const fakeId = '00000000-0000-4000-a000-000000000001';
    const res = await request.get(`${BASE_URL}/api/associations/${fakeId}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /api/associations/:id/join by a second user → 200/201', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { user: joiner, tokens: joinerTokens } = await register(request, randomEmail());
    verifyEmailInDb(joiner.id);

    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `TestAssoc-join-${Date.now()}`,
        category: 'sport',
        requiresApproval: false,
        countryCode: 'NE',
        city: 'Niamey',
      },
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(createRes.status()).toBe(201);
    const assoc = await createRes.json() as { id: string };

    const joinRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: { Authorization: `Bearer ${joinerTokens.accessToken}` },
    });
    expect([200, 201]).toContain(joinRes.status());
  });

  test('DELETE /api/associations/:id/leave as last admin → 400', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: { name: `TestAssoc-leave-${Date.now()}`, category: 'business', countryCode: 'NE', city: 'Niamey' },
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(createRes.status()).toBe(201);
    const assoc = await createRes.json() as { id: string };

    // Sole admin tries to leave → must be rejected
    const leaveRes = await request.delete(`${BASE_URL}/api/associations/${assoc.id}/leave`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(leaveRes.status()).toBe(400);
  });

  test('DELETE /api/associations/:id/leave by a non-last member → 204', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { user: joiner, tokens: joinerTokens } = await register(request, randomEmail());
    verifyEmailInDb(joiner.id);

    const createRes = await request.post(`${BASE_URL}/api/associations`, {
      data: {
        name: `TestAssoc-leave2-${Date.now()}`,
        category: 'jeunesse',
        requiresApproval: false,
        countryCode: 'NE',
        city: 'Niamey',
      },
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(createRes.status()).toBe(201);
    const assoc = await createRes.json() as { id: string };

    // Joiner joins first
    const joinRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: { Authorization: `Bearer ${joinerTokens.accessToken}` },
    });
    expect([200, 201]).toContain(joinRes.status());

    // Joiner (non-admin) leaves — must succeed
    const leaveRes = await request.delete(`${BASE_URL}/api/associations/${assoc.id}/leave`, {
      headers: { Authorization: `Bearer ${joinerTokens.accessToken}` },
    });
    expect(leaveRes.status()).toBe(204);
  });
});

// ── Bug 3: Comment live deletion — commentCount decrements correctly ─────────

test.describe('Comments (bug 3 — live deletion)', () => {
  test('DELETE /api/comments/:id → 204; commentCount decremented; comment gone from list', async ({ request }) => {
    // Author creates a public post (public = accessible to themselves)
    const { user: author, tokens: authorTokens } = await register(request, randomEmail());
    verifyEmailInDb(author.id);

    const postRes = await request.post(`${BASE_URL}/api/posts`, {
      data: { content: 'E2E comment deletion test post', visibility: 'public' },
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(postRes.status(), `create post: ${await postRes.text()}`).toBe(201);
    const post = await postRes.json() as { id: string; commentCount: number };
    expect(post.commentCount).toBe(0);

    // Author comments on their own post
    const commentRes = await request.post(`${BASE_URL}/api/posts/${post.id}/comments`, {
      data: { content: 'Hello, this is a test comment' },
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(commentRes.status(), `create comment: ${await commentRes.text()}`).toBe(201);
    const comment = await commentRes.json() as { id: string };

    // Confirm commentCount is now 1
    const postAfterComment = await request.get(`${BASE_URL}/api/posts/${post.id}`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}` },
    });
    expect(postAfterComment.status()).toBe(200);
    const postBody1 = await postAfterComment.json() as { commentCount: number };
    expect(postBody1.commentCount, 'commentCount should be 1 after adding a comment').toBe(1);

    // Delete the comment
    const deleteRes = await request.delete(`${BASE_URL}/api/comments/${comment.id}`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}` },
    });
    expect(deleteRes.status(), `delete comment: status`).toBe(204);

    // commentCount must be back to 0
    const postAfterDelete = await request.get(`${BASE_URL}/api/posts/${post.id}`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}` },
    });
    expect(postAfterDelete.status()).toBe(200);
    const postBody2 = await postAfterDelete.json() as { commentCount: number };
    expect(postBody2.commentCount, 'commentCount should be 0 after deleting the comment').toBe(0);

    // Comment must no longer appear in the comments list
    const commentsRes = await request.get(`${BASE_URL}/api/posts/${post.id}/comments`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}` },
    });
    expect(commentsRes.status()).toBe(200);
    const commentsBody = await commentsRes.json() as { items: Array<{ id: string }> };
    const found = commentsBody.items.some((c) => c.id === comment.id);
    expect(found, 'deleted comment must not appear in the comments list').toBe(false);

    // suppress unused variable warning
    void author;
  });

  test('DELETE /api/comments/:id by non-owner → 403', async ({ request }) => {
    const { user: authorUser, tokens: authorTokens } = await register(request, randomEmail());
    const { user: otherUser, tokens: otherTokens } = await register(request, randomEmail());
    verifyEmailInDb(authorUser.id);
    verifyEmailInDb(otherUser.id);

    const postRes = await request.post(`${BASE_URL}/api/posts`, {
      data: { content: 'Post for 403 comment test', visibility: 'public' },
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(postRes.status()).toBe(201);
    const post = await postRes.json() as { id: string };

    const commentRes = await request.post(`${BASE_URL}/api/posts/${post.id}/comments`, {
      data: { content: 'Owned comment' },
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(commentRes.status()).toBe(201);
    const comment = await commentRes.json() as { id: string };

    // Non-owner tries to delete → 403
    const deleteRes = await request.delete(`${BASE_URL}/api/comments/${comment.id}`, {
      headers: { Authorization: `Bearer ${otherTokens.accessToken}` },
    });
    expect(deleteRes.status()).toBe(403);
  });

  test('POST /api/posts/:id/comments by a friend on a friends-only post → 201', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await register(request, randomEmail());
    const { user: userB, tokens: tokensB } = await register(request, randomEmail());
    verifyEmailInDb(userA.id);
    verifyEmailInDb(userB.id);

    // A creates a friends-only post
    const postRes = await request.post(`${BASE_URL}/api/posts`, {
      data: { content: 'Friends-only post', visibility: 'friends' },
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(postRes.status()).toBe(201);
    const post = await postRes.json() as { id: string };

    // B sends a friend request, A accepts
    const reqRes = await request.post(`${BASE_URL}/api/friends/request/${userA.id}`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}` },
    });
    expect([200, 201]).toContain(reqRes.status());
    const friendship = await reqRes.json() as { id: string };

    const acceptRes = await request.post(`${BASE_URL}/api/friends/accept/${friendship.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}` },
    });
    expect([200, 201]).toContain(acceptRes.status());

    // B (now a friend) comments on A's post → 201
    const commentRes = await request.post(`${BASE_URL}/api/posts/${post.id}/comments`, {
      data: { content: 'Comment from friend' },
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'Content-Type': 'application/json' },
    });
    expect(commentRes.status(), `friend comment: ${await commentRes.text()}`).toBe(201);

    void userB;
  });
});
