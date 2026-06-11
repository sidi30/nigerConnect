/**
 * association-posts.spec.ts
 *
 * Regression / contract tests for the "association-scoped posts" feature.
 * Backend sources: apps/api/src/feed (PostsService, LikesService, CommentsService)
 *                  apps/api/src/association (AssociationService).
 *
 * Covered scenarios
 * ─────────────────
 * P1. CREATE — approved member creates an association post → 201
 * P2. CREATE — non-member → 403
 * P3. CREATE — pending (not-yet-approved) member → 403
 *
 * F1. GET /api/associations/:id/posts — approved member sees post → 200, item present
 * F2. GET /api/associations/:id/posts — non-member → 403
 * F3. GET /api/associations/:id/posts — pending member → 403
 *
 * PV1. FEED PRIVACY — assoc post absent from non-member's GET /api/feed
 * PV2. FEED PRIVACY — second approved member DOES see it in /api/feed
 * PV3. FEED PRIVACY — friend-of-author who is NOT a member:
 *        • does NOT see post in /api/feed
 *        • GET /api/posts/:id → 404 (existence is private info)
 *
 * G1.  GATING — non-member POST /api/posts/:id/like → 404 (assertCanViewPost returns 404)
 * G2.  GATING — non-member POST /api/posts/:id/comments → 404
 *
 * CUR. CURSOR PAGINATION — GET /api/associations/:id/posts pages correctly through
 *        several posts using the nextCursor returned in each response.
 *
 * Prerequisites (servers must already be running — NOT started here):
 *   API   http://127.0.0.1:3000  (NestJS, global prefix /api)
 *   Postgres: docker exec nigerconnect-postgres psql …
 *   Redis:    docker exec nigerconnect-redis redis-cli …
 *
 * Run:
 *   cd e2e
 *   API_BASE_URL=http://127.0.0.1:3000 npx playwright test \
 *     tests/api/association-posts.spec.ts \
 *     --project=api-association-posts
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

/**
 * Insert an accepted friendship directly in DB.
 * The feed visibility for association posts does NOT depend on friendship — this
 * helper is only used in the PV3 / friend-of-author test group.
 */
function makeFriendsInDb(userAId: string, userBId: string): void {
  const id = crypto.randomUUID();
  psql(
    `INSERT INTO friendships (id, requester_id, addressee_id, status, updated_at)
     VALUES ('${id}', '${userAId}', '${userBId}', 'accepted', NOW())
     ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted';`,
  );
}

/**
 * Flush the Redis feed cache for a user so stale cached pages don't mask
 * visibility failures. Best-effort — silently ignored if the Redis container
 * is unreachable.
 */
function bustFeedCache(userId: string): void {
  try {
    execSync(
      `docker exec nigerconnect-redis redis-cli DEL "feed:${userId}:start"`,
      { stdio: 'pipe' },
    );
  } catch {
    // Redis container may not be named nigerconnect-redis in all envs; not fatal.
  }
}

// ── Request helpers ────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2eap'): string {
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
      firstName: 'AssocPostE2E',
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
 * Register, verify email, approve identity, then re-login so the JWT carries
 * identity_status='approved'. Required for creating associations.
 * Mirrors the same pattern in association-membership-invites.spec.ts.
 */
async function registerApproved(
  request: APIRequestContext,
  prefix = 'e2eapadmin',
): Promise<{ user: AuthResponse['user']; tokens: TokenPair; email: string }> {
  const email = randomEmail(prefix);
  const { user } = await register(request, email);
  verifyEmailInDb(user.id);
  approveIdentityInDb(user.id);
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    loginRes.status(),
    `login after approve → expected 200, got ${loginRes.status()}`,
  ).toBe(200);
  const loginBody = (await loginRes.json()) as AuthResponse;
  return { user, tokens: loginBody.tokens, email };
}

/** Register + verify email only (identity NOT approved). */
async function registerVerified(
  request: APIRequestContext,
  prefix = 'e2eapuser',
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
 * Create an association with requiresApproval=true, owned by the given token.
 * The caller must already hold an approved-identity JWT.
 */
async function createAssoc(
  request: APIRequestContext,
  accessToken: string,
  suffix = '',
): Promise<{ id: string; name: string; memberCount: number; requiresApproval: boolean }> {
  const name = `E2eAssocPosts-${Date.now()}${suffix}`;
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
    `createAssoc → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as {
    id: string;
    name: string;
    memberCount: number;
    requiresApproval: boolean;
  };
}

/**
 * Full join+approve cycle: userAuth requests to join, adminTokens approves.
 * After this call the user is an approved member of the association.
 */
async function joinAndApprove(
  request: APIRequestContext,
  adminToken: string,
  assocId: string,
  userAuth: AuthResponse,
): Promise<void> {
  const joinRes = await request.post(`${BASE_URL}/api/associations/${assocId}/join`, {
    headers: authHeaders(userAuth.tokens.accessToken),
  });
  expect(
    joinRes.status(),
    `join assoc → expected 201, got ${joinRes.status()}: ${await joinRes.text()}`,
  ).toBe(201);

  const approveRes = await request.post(
    `${BASE_URL}/api/associations/${assocId}/members/${userAuth.user.id}/approve`,
    { headers: authHeaders(adminToken) },
  );
  expect(
    approveRes.status(),
    `approve member → expected 201, got ${approveRes.status()}: ${await approveRes.text()}`,
  ).toBe(201);
}

/**
 * Create an association post as an approved member.
 * Visibility is fixed at 'association'; the associationId is embedded.
 */
async function createAssocPost(
  request: APIRequestContext,
  accessToken: string,
  assocId: string,
  content: string,
): Promise<{ id: string; [k: string]: unknown }> {
  const res = await request.post(`${BASE_URL}/api/posts`, {
    data: { content, visibility: 'association', associationId: assocId },
    headers: authHeaders(accessToken),
  });
  expect(
    res.status(),
    `createAssocPost → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as { id: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// P. CREATE — association post
// ─────────────────────────────────────────────────────────────────────────────

test.describe('P. Create association post', () => {

  test('P1. Approved member creates an association post → 201 with correct fields', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ep1admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-P1');

    const res = await request.post(`${BASE_URL}/api/posts`, {
      data: {
        content: `Association post P1 ${Date.now()}`,
        visibility: 'association',
        associationId: assoc.id,
      },
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      res.status(),
      `approved member create assoc post → expected 201, got ${res.status()}: ${await res.text()}`,
    ).toBe(201);

    const body = (await res.json()) as {
      id: string;
      visibility: string;
      associationId: string;
    };
    expect(typeof body.id, 'created post must have a string id (UUID)').toBe('string');
    expect(body.visibility, 'post visibility must be "association"').toBe('association');
    expect(body.associationId, 'post associationId must match the assoc id').toBe(assoc.id);
  });

  test('P2. Non-member creating an association post → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ep2admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-P2');

    const nonMember = await registerVerified(request, 'e2ep2nonmember');

    const res = await request.post(`${BASE_URL}/api/posts`, {
      data: {
        content: `Non-member association post P2 ${Date.now()}`,
        visibility: 'association',
        associationId: assoc.id,
      },
      headers: authHeaders(nonMember.tokens.accessToken),
    });

    expect(
      res.status(),
      `non-member create assoc post → expected 403, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('P3. Pending (not-yet-approved) member creating an association post → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ep3admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-P3');

    const pendingUser = await registerVerified(request, 'e2ep3pending');

    // User requests to join but is NOT approved — stays pending.
    const joinRes = await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(pendingUser.tokens.accessToken),
    });
    expect(
      joinRes.status(),
      `pending user join → expected 201, got ${joinRes.status()}: ${await joinRes.text()}`,
    ).toBe(201);
    const joinBody = (await joinRes.json()) as { pending: boolean };
    expect(joinBody.pending, 'join for requiresApproval assoc must be pending').toBe(true);

    // Pending user tries to create an assoc post → must be 403 (not approved).
    const res = await request.post(`${BASE_URL}/api/posts`, {
      data: {
        content: `Pending member association post P3 ${Date.now()}`,
        visibility: 'association',
        associationId: assoc.id,
      },
      headers: authHeaders(pendingUser.tokens.accessToken),
    });

    expect(
      res.status(),
      `pending member create assoc post → expected 403, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. GET /api/associations/:id/posts
// ─────────────────────────────────────────────────────────────────────────────

test.describe('F. GET /api/associations/:id/posts', () => {

  test('F1. Approved member fetches association feed → 200, created post is present', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ef1admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-F1');

    const content = `AssocFeed post F1 ${Date.now()}`;
    const post = await createAssocPost(request, admin.tokens.accessToken, assoc.id, content);

    const feedRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/posts`, {
      headers: authHeaders(admin.tokens.accessToken),
    });

    expect(
      feedRes.status(),
      `GET /associations/${assoc.id}/posts → expected 200, got ${feedRes.status()}: ${await feedRes.text()}`,
    ).toBe(200);

    const body = (await feedRes.json()) as { items: Array<{ id: string }> };
    expect(Array.isArray(body.items), 'items must be an array').toBe(true);

    const found = body.items.some((p) => p.id === post.id);
    expect(
      found,
      `Created post ${post.id} must appear in association feed`,
    ).toBe(true);
  });

  test('F2. Non-member calling GET /api/associations/:id/posts → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ef2admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-F2');

    const nonMember = await registerVerified(request, 'e2ef2nonmember');

    const feedRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/posts`, {
      headers: authHeaders(nonMember.tokens.accessToken),
    });

    expect(
      feedRes.status(),
      `non-member GET association posts → expected 403, got ${feedRes.status()}`,
    ).toBe(403);
  });

  test('F3. Pending member calling GET /api/associations/:id/posts → 403', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ef3admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-F3');

    const pendingUser = await registerVerified(request, 'e2ef3pending');

    // Request to join but leave unapproved.
    await request.post(`${BASE_URL}/api/associations/${assoc.id}/join`, {
      headers: authHeaders(pendingUser.tokens.accessToken),
    });

    const feedRes = await request.get(`${BASE_URL}/api/associations/${assoc.id}/posts`, {
      headers: authHeaders(pendingUser.tokens.accessToken),
    });

    expect(
      feedRes.status(),
      `pending member GET association posts → expected 403, got ${feedRes.status()}`,
    ).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PV. FEED PRIVACY — /api/feed isolation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('PV. Feed privacy — association post isolation', () => {

  test('PV1. Association post does NOT appear in a non-member\'s /api/feed', async ({ request }) => {
    const admin = await registerApproved(request, 'e2epv1admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-PV1');

    await createAssocPost(request, admin.tokens.accessToken, assoc.id, `PV1 assoc post ${Date.now()}`);

    const outsider = await registerVerified(request, 'e2epv1outsider');
    bustFeedCache(outsider.user.id);

    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: authHeaders(outsider.tokens.accessToken),
    });
    expect(
      feedRes.status(),
      `outsider GET /feed → expected 200, got ${feedRes.status()}`,
    ).toBe(200);

    // The outsider is a completely different account: their feed must have no
    // posts from admin's association at all (or at minimum not the assoc-scoped one).
    // Because admin could have other public/friends posts we specifically look at
    // visibility: any item with visibility='association' and the matching
    // associationId must NOT be present. We cannot check by post.id here because
    // we don't have it in this scope, so we use the stronger invariant: no
    // association-scoped item for this assocId should ever appear for a non-member.
    const feedBody = (await feedRes.json()) as {
      items: Array<{ id: string; visibility: string; associationId?: string | null }>;
    };
    const leaked = feedBody.items.filter(
      (p) => p.visibility === 'association' && p.associationId === assoc.id,
    );
    expect(
      leaked.length,
      `Non-member feed must contain 0 association posts for assoc ${assoc.id}`,
    ).toBe(0);
  });

  test('PV2. Second approved member DOES see the association post in /api/feed', async ({ request }) => {
    const admin = await registerApproved(request, 'e2epv2admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-PV2');

    const content = `PV2 assoc post visible to member ${Date.now()}`;
    const post = await createAssocPost(request, admin.tokens.accessToken, assoc.id, content);

    // Enrol a second approved member.
    const memberB = await registerVerified(request, 'e2epv2memberb');
    await joinAndApprove(request, admin.tokens.accessToken, assoc.id, memberB);

    bustFeedCache(memberB.user.id);

    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: authHeaders(memberB.tokens.accessToken),
    });
    expect(
      feedRes.status(),
      `second member GET /feed → expected 200, got ${feedRes.status()}`,
    ).toBe(200);

    const feedBody = (await feedRes.json()) as { items: Array<{ id: string }> };
    const ids = feedBody.items.map((p) => p.id);
    expect(
      ids,
      `Approved member B must see association post ${post.id} in their feed`,
    ).toContain(post.id);
  });

  test('PV3. Friend-of-author (non-member): not in /api/feed; GET /api/posts/:id → 404', async ({ request }) => {
    const admin = await registerApproved(request, 'e2epv3admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-PV3');

    const content = `PV3 assoc post ${Date.now()}`;
    const post = await createAssocPost(request, admin.tokens.accessToken, assoc.id, content);

    // Register a friend of admin (not a member of the association).
    const friend = await registerVerified(request, 'e2epv3friend');
    // Establish friendship via DB — friend is NOT a member of the association.
    makeFriendsInDb(admin.user.id, friend.user.id);

    bustFeedCache(friend.user.id);

    // 1. The assoc post must NOT appear in friend's feed.
    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: authHeaders(friend.tokens.accessToken),
    });
    expect(
      feedRes.status(),
      `friend GET /feed → expected 200, got ${feedRes.status()}`,
    ).toBe(200);

    const feedBody = (await feedRes.json()) as {
      items: Array<{ id: string; visibility: string; associationId?: string | null }>;
    };
    const leaked = feedBody.items.filter(
      (p) => p.visibility === 'association' && p.associationId === assoc.id,
    );
    expect(
      leaked.length,
      `Friend's feed must contain 0 association posts for assoc ${assoc.id} (friendship is not membership)`,
    ).toBe(0);

    // 2. Direct fetch of the post must return 404 — the API hides existence from
    //    non-members (see assertCanViewPost: 404, not 403, to avoid existence leak).
    const directRes = await request.get(`${BASE_URL}/api/posts/${post.id}`, {
      headers: authHeaders(friend.tokens.accessToken),
    });
    expect(
      directRes.status(),
      `friend GET /posts/${post.id} → expected 404 (existence hidden from non-member), got ${directRes.status()}`,
    ).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. GATING — like and comment endpoints for non-members
// ─────────────────────────────────────────────────────────────────────────────

test.describe('G. Gating — like/comment on association post by non-member', () => {

  test('G1. Non-member calling POST /api/posts/:id/like → 404 (post hidden from non-member)', async ({ request }) => {
    const admin = await registerApproved(request, 'e2eg1admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-G1');
    const post = await createAssocPost(request, admin.tokens.accessToken, assoc.id, `G1 post ${Date.now()}`);

    const nonMember = await registerVerified(request, 'e2eg1nonmember');

    // LikesService.toggleLike calls assertCanViewPost, which returns 404 for
    // non-members of an association post (to avoid confirming the post exists).
    const likeRes = await request.post(`${BASE_URL}/api/posts/${post.id}/like`, {
      headers: authHeaders(nonMember.tokens.accessToken),
    });

    expect(
      likeRes.status(),
      `non-member like assoc post → expected 404 (post existence hidden), got ${likeRes.status()}: ${await likeRes.text()}`,
    ).toBe(404);
  });

  test('G2. Non-member calling POST /api/posts/:id/comments → 404', async ({ request }) => {
    const admin = await registerApproved(request, 'e2eg2admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-G2');
    const post = await createAssocPost(request, admin.tokens.accessToken, assoc.id, `G2 post ${Date.now()}`);

    const nonMember = await registerVerified(request, 'e2eg2nonmember');

    // CommentsService.create calls assertCanViewPost, same 404 gate.
    const commentRes = await request.post(`${BASE_URL}/api/posts/${post.id}/comments`, {
      data: { content: 'Non-member comment attempt' },
      headers: authHeaders(nonMember.tokens.accessToken),
    });

    expect(
      commentRes.status(),
      `non-member comment on assoc post → expected 404 (post existence hidden), got ${commentRes.status()}: ${await commentRes.text()}`,
    ).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CUR. CURSOR PAGINATION of /api/associations/:id/posts
// ─────────────────────────────────────────────────────────────────────────────

test.describe('CUR. Cursor pagination of GET /api/associations/:id/posts', () => {

  test('CUR1. Pages through 5 posts in pages of 2, all posts eventually returned, no duplicates', async ({ request }) => {
    const admin = await registerApproved(request, 'e2ecur1admin');
    const assoc = await createAssoc(request, admin.tokens.accessToken, '-CUR1');

    // Create 5 distinct posts. Each is a separate request so createdAt timestamps
    // are unique (NestJS/Postgres is fast enough that a tight loop might produce
    // the same millisecond — the content carries a unique index as extra guard).
    const TOTAL = 5;
    const createdIds: string[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const p = await createAssocPost(
        request,
        admin.tokens.accessToken,
        assoc.id,
        `Pagination post CUR1-${i + 1} at ${Date.now()}`,
      );
      createdIds.push(p.id);
    }

    // Page through with limit=2 until exhausted.
    const PAGE_SIZE = 2;
    const collectedIds: string[] = [];
    let cursor: string | null = null;
    let iterations = 0;
    const MAX_ITERATIONS = TOTAL + 2; // safety cap against infinite loops

    do {
      const url = `${BASE_URL}/api/associations/${assoc.id}/posts?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const pageRes = await request.get(url, {
        headers: authHeaders(admin.tokens.accessToken),
      });

      expect(
        pageRes.status(),
        `pagination page ${iterations + 1} → expected 200, got ${pageRes.status()}`,
      ).toBe(200);

      const pageBody = (await pageRes.json()) as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };

      expect(Array.isArray(pageBody.items), `page ${iterations + 1}: items must be an array`).toBe(true);
      expect(
        pageBody.items.length,
        `page ${iterations + 1} must return ≤ ${PAGE_SIZE} items`,
      ).toBeLessThanOrEqual(PAGE_SIZE);

      for (const item of pageBody.items) {
        collectedIds.push(item.id);
      }

      cursor = pageBody.nextCursor;
      iterations++;
    } while (cursor !== null && iterations < MAX_ITERATIONS);

    // All 5 posts must have been returned across all pages.
    for (const id of createdIds) {
      expect(
        collectedIds,
        `Post ${id} must appear in paginated results`,
      ).toContain(id);
    }

    // No post should appear on more than one page (no duplicate delivery).
    const unique = new Set(collectedIds);
    expect(
      unique.size,
      `No duplicates across pages — expected ${collectedIds.length} unique, got ${unique.size}`,
    ).toBe(collectedIds.length);

    // After exhausting the cursor the last page should have returned nextCursor=null.
    expect(cursor, 'nextCursor must be null after the last page').toBeNull();
  });
});
