/**
 * feed-comments.spec.ts
 *
 * Contract / regression tests for:
 *   A. COMMENTS — 3-level nesting enforcement + cascade delete
 *   B. FEED PRIVACY — private-profile gate (feed + single-post + getUserPosts)
 *
 * Prerequisites (servers must already be running — NOT started here):
 *   API   http://127.0.0.1:3000  (NestJS, prefix /api)
 *   Postgres reachable via: docker exec nigerconnect-postgres psql …
 *
 * Run:
 *   cd e2e
 *   API_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/api/feed-comments.spec.ts --project=api-feed-comments
 */

import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helpers ─────────────────────────────────────────────────────────────────

function psql(sql: string): string {
  // Collapse whitespace so the SQL fits in a single-line shell argument.
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(
    `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${oneLine.replace(/"/g, '\\"')}"`,
    { stdio: 'pipe' },
  ).toString();
}

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function setPrivacyLevel(userId: string, level: 'public' | 'friends' | 'private'): void {
  psql(`UPDATE users SET privacy_level = '${level}' WHERE id = '${userId}';`);
}

function makeFriends(userAId: string, userBId: string): void {
  // Insert an accepted friendship (direction: A requested, B accepted).
  // gen_random_uuid() requires pgcrypto; use uuid-ossp alternative or gen via node.
  const id = crypto.randomUUID();
  psql(
    `INSERT INTO friendships (id, requester_id, addressee_id, status, updated_at)
     VALUES ('${id}', '${userAId}', '${userBId}', 'accepted', NOW())
     ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted';`,
  );
}

function getPostCommentCount(postId: string): number {
  const out = psql(
    `SELECT comment_count FROM posts WHERE id = '${postId}';`,
  );
  const match = out.match(/\d+/);
  return match ? parseInt(match[0], 10) : -1;
}

function getCommentRow(commentId: string): { deleted_at: string | null } | null {
  const out = psql(
    `SELECT row_to_json(t) FROM (SELECT deleted_at FROM comments WHERE id = '${commentId}') t;`,
  );
  const match = out.match(/\{.*\}/);
  return match ? (JSON.parse(match[0]) as { deleted_at: string | null }) : null;
}

function invalidateFeedCache(userId: string): void {
  // Best-effort flush via psql — Redis key feed:<uid>:start is TTL 120s, so for
  // tests that don't rely on cache freshness we bust it through the running Redis.
  // Use redis-cli through docker if available; silently skip if not.
  try {
    execSync(
      `docker exec nigerconnect-redis redis-cli DEL "feed:${userId}:start"`,
      { stdio: 'pipe' },
    );
  } catch {
    // redis container name may differ; not fatal — tests use fresh posts
  }
}

// ── Request helpers ────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2efc'): string {
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
  extra: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email,
      password: VALID_PASSWORD,
      firstName: 'FeedE2E',
      lastName: 'Test',
      ...extra,
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

/** Register + immediately verify email in DB so guarded endpoints are reachable. */
async function registerVerified(
  request: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const auth = await register(request, email, extra);
  verifyEmailInDb(auth.user.id);
  return auth;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

async function createPost(
  request: APIRequestContext,
  token: string,
  content: string,
  visibility: 'public' | 'friends' = 'public',
): Promise<{ id: string; [k: string]: unknown }> {
  const res = await request.post(`${BASE_URL}/api/posts`, {
    data: { content, visibility },
    headers: authHeaders(token),
  });
  expect(
    res.status(),
    `createPost → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as { id: string };
}

async function createComment(
  request: APIRequestContext,
  token: string,
  postId: string,
  content: string,
  parentId?: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BASE_URL}/api/posts/${postId}/comments`, {
    data: parentId ? { content, parentId } : { content },
    headers: authHeaders(token),
  });
  return { status: res.status(), body: await res.json() };
}

// ── SECTION A: COMMENTS ────────────────────────────────────────────────────────

test.describe('A. Comments — 3-level nesting', () => {

  test('A1. Nesting depth: root → L2 → L3 succeed; L4 → 400 "3 niveaux"', async ({ request }) => {
    const { tokens } = await registerVerified(request, randomEmail('a1author'));
    const post = await createPost(request, tokens.accessToken, 'Post for nesting test A1');

    // Root comment (L1)
    const r1 = await createComment(request, tokens.accessToken, post.id, 'Root comment');
    expect(r1.status, `L1 comment → expected 201, got ${r1.status}`).toBe(201);
    const rootComment = r1.body as { id: string };

    // L2 — reply to root
    const r2 = await createComment(
      request, tokens.accessToken, post.id, 'Level-2 reply', rootComment.id,
    );
    expect(r2.status, `L2 comment → expected 201, got ${r2.status}`).toBe(201);
    const l2Comment = r2.body as { id: string };

    // L3 — reply to L2
    const r3 = await createComment(
      request, tokens.accessToken, post.id, 'Level-3 reply', l2Comment.id,
    );
    expect(r3.status, `L3 comment → expected 201, got ${r3.status}`).toBe(201);
    const l3Comment = r3.body as { id: string };

    // L4 — reply to L3 → must be rejected
    const r4 = await createComment(
      request, tokens.accessToken, post.id, 'Level-4 reply (should fail)', l3Comment.id,
    );
    expect(r4.status, `L4 comment → expected 400, got ${r4.status}`).toBe(400);
    const errBody = r4.body as { message?: string };
    expect(
      typeof errBody.message === 'string' && errBody.message.includes('3 niveaux'),
      `400 body must mention "3 niveaux", got: ${JSON.stringify(errBody)}`,
    ).toBe(true);
  });

  test('A2. GET /api/posts/:id/comments returns 3-level nested structure', async ({ request }) => {
    const { tokens } = await registerVerified(request, randomEmail('a2author'));
    const post = await createPost(request, tokens.accessToken, 'Post for nested GET A2');

    // Build root → L2 → L3 chain
    const r1 = await createComment(request, tokens.accessToken, post.id, 'Root A2');
    const rootId = (r1.body as { id: string }).id;

    const r2 = await createComment(request, tokens.accessToken, post.id, 'L2 A2', rootId);
    const l2Id = (r2.body as { id: string }).id;

    await createComment(request, tokens.accessToken, post.id, 'L3 A2', l2Id);

    // Fetch comments tree
    const listRes = await request.get(`${BASE_URL}/api/posts/${post.id}/comments`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(listRes.status(), `GET comments → expected 200, got ${listRes.status()}`).toBe(200);

    const body = (await listRes.json()) as {
      items: Array<{
        id: string;
        content: string;
        replies?: Array<{
          id: string;
          content: string;
          replies?: Array<{ id: string; content: string }>;
        }>;
      }>;
    };

    expect(Array.isArray(body.items), 'items must be an array').toBe(true);

    // Find the root we created
    const root = body.items.find((c) => c.id === rootId);
    expect(root, `Root comment ${rootId} must appear in items`).toBeDefined();

    // Root must have L2 in its replies
    expect(
      Array.isArray(root!.replies) && root!.replies.length > 0,
      'Root must have at least one reply (L2)',
    ).toBe(true);

    const l2 = root!.replies!.find((c) => c.id === l2Id);
    expect(l2, `L2 comment ${l2Id} must appear in root.replies`).toBeDefined();

    // L2 must have L3 in its replies
    expect(
      Array.isArray(l2!.replies) && l2!.replies.length > 0,
      'L2 must have at least one reply (L3)',
    ).toBe(true);

    const l3 = l2!.replies![0]!;
    expect(typeof l3.id, 'L3 reply must have an id').toBe('string');
    expect(l3.content, 'L3 content must match').toBe('L3 A2');
  });

  test('A3. Cascade delete: deleting root removes L2+L3 and decrements commentCount to 0', async ({ request }) => {
    const { tokens } = await registerVerified(request, randomEmail('a3author'));
    const post = await createPost(request, tokens.accessToken, 'Post for cascade delete A3');

    // Build root → L2 → L3 (3 comments total)
    const r1 = await createComment(request, tokens.accessToken, post.id, 'Root A3');
    const rootId = (r1.body as { id: string }).id;

    const r2 = await createComment(request, tokens.accessToken, post.id, 'L2 A3', rootId);
    const l2Id = (r2.body as { id: string }).id;

    const r3 = await createComment(request, tokens.accessToken, post.id, 'L3 A3', l2Id);
    const l3Id = (r3.body as { id: string }).id;

    // Confirm comment_count == 3 before delete
    const countBefore = getPostCommentCount(post.id);
    expect(countBefore, 'comment_count must be 3 after adding root+L2+L3').toBe(3);

    // DELETE the root comment
    const delRes = await request.delete(`${BASE_URL}/api/comments/${rootId}`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(delRes.status(), `DELETE root comment → expected 204, got ${delRes.status()}`).toBe(204);

    // GET comments → items must be empty (all soft-deleted)
    const listRes = await request.get(`${BASE_URL}/api/posts/${post.id}/comments`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(listRes.status(), 'GET comments after cascade delete must return 200').toBe(200);
    const body = (await listRes.json()) as { items: unknown[] };
    expect(body.items.length, 'items must be empty after cascade delete of root').toBe(0);

    // DB: comment_count must be 0 (decremented by whole subtree = 3)
    const countAfter = getPostCommentCount(post.id);
    expect(countAfter, 'comment_count must be 0 after cascade delete of 3-comment subtree').toBe(0);

    // DB: all 3 comment rows must have deleted_at set (soft-delete)
    for (const [id, label] of [[rootId, 'root'], [l2Id, 'L2'], [l3Id, 'L3']] as const) {
      const row = getCommentRow(id);
      expect(row, `${label} comment row must exist in DB`).not.toBeNull();
      expect(
        row!.deleted_at,
        `${label} comment must have deleted_at set after cascade`,
      ).not.toBeNull();
    }
  });

});

// ── SECTION B: FEED PRIVACY ────────────────────────────────────────────────────

test.describe('B. Feed privacy — private profile gate', () => {

  /**
   * Shared setup:
   *   P = private author (privacy_level='private'), verified
   *   S = stranger viewer, verified, NOT friends with P initially
   */
  async function setupPrivacyPair(request: APIRequestContext) {
    const authP = await registerVerified(request, randomEmail('bpriv'));
    const authS = await registerVerified(request, randomEmail('bstranger'));
    setPrivacyLevel(authP.user.id, 'private');
    return { authP, authS };
  }

  test('B4. Stranger cannot see private-author public post in feed', async ({ request }) => {
    const { authP, authS } = await setupPrivacyPair(request);

    // P creates a public post
    const post = await createPost(
      request, authP.tokens.accessToken,
      `Private-author public post B4 ${Date.now()}`, 'public',
    );

    // Invalidate S's feed cache so we don't get a stale result
    invalidateFeedCache(authS.user.id);

    // S fetches feed — P's post must NOT appear
    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: authHeaders(authS.tokens.accessToken),
    });
    expect(feedRes.status(), `GET /feed → expected 200, got ${feedRes.status()}`).toBe(200);

    const feedBody = (await feedRes.json()) as { items: Array<{ id: string }> };
    const ids = feedBody.items.map((i) => i.id);
    expect(
      ids,
      `Stranger must NOT see private-author post ${post.id} in feed`,
    ).not.toContain(post.id);
  });

  test('B5. Friend sees private-author public post in feed', async ({ request }) => {
    const { authP, authS } = await setupPrivacyPair(request);

    // P creates a public post
    const post = await createPost(
      request, authP.tokens.accessToken,
      `Private-author public post B5 ${Date.now()}`, 'public',
    );

    // Make S a friend of P (psql — direct insert)
    makeFriends(authS.user.id, authP.user.id);

    // Bust both users' feed caches so friendship change is visible
    invalidateFeedCache(authS.user.id);
    invalidateFeedCache(authP.user.id);

    // S fetches feed — P's post MUST now appear
    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: authHeaders(authS.tokens.accessToken),
    });
    expect(feedRes.status(), `GET /feed → expected 200, got ${feedRes.status()}`).toBe(200);

    const feedBody = (await feedRes.json()) as { items: Array<{ id: string }> };
    const ids = feedBody.items.map((i) => i.id);
    expect(
      ids,
      `Friend must see private-author post ${post.id} in feed after friendship`,
    ).toContain(post.id);
  });

  test('B6. Single-post leak gate: stranger gets 404; friend gets 200', async ({ request }) => {
    const { authP, authS } = await setupPrivacyPair(request);

    const post = await createPost(
      request, authP.tokens.accessToken,
      `Private-author public post B6 ${Date.now()}`, 'public',
    );

    // Stranger: GET /api/posts/:id → must be 404 (existence hidden)
    const strangerRes = await request.get(`${BASE_URL}/api/posts/${post.id}`, {
      headers: authHeaders(authS.tokens.accessToken),
    });
    expect(
      strangerRes.status(),
      `Stranger GET /posts/${post.id} → expected 404, got ${strangerRes.status()}`,
    ).toBe(404);

    // Friend: make friendship, then try again → 200
    makeFriends(authS.user.id, authP.user.id);

    const friendRes = await request.get(`${BASE_URL}/api/posts/${post.id}`, {
      headers: authHeaders(authS.tokens.accessToken),
    });
    expect(
      friendRes.status(),
      `Friend GET /posts/${post.id} → expected 200, got ${friendRes.status()}`,
    ).toBe(200);

    const postBody = (await friendRes.json()) as { id: string };
    expect(postBody.id, 'returned post id must match').toBe(post.id);
  });

  test('B7a. getUserPosts: stranger gets empty list for private author', async ({ request }) => {
    const { authP, authS } = await setupPrivacyPair(request);

    // P creates posts so there is content to be hidden
    await createPost(request, authP.tokens.accessToken, `Hidden post B7a-1 ${Date.now()}`, 'public');
    await createPost(request, authP.tokens.accessToken, `Hidden post B7a-2 ${Date.now()}`, 'public');

    const res = await request.get(`${BASE_URL}/api/users/${authP.user.id}/posts`, {
      headers: authHeaders(authS.tokens.accessToken),
    });
    expect(res.status(), `GET /users/:P/posts → expected 200, got ${res.status()}`).toBe(200);

    const body = (await res.json()) as { items: unknown[] };
    expect(
      body.items.length,
      'Stranger must see 0 posts from a private author',
    ).toBe(0);
  });

  test('B7b. getUserPosts: stranger sees public posts from public author', async ({ request }) => {
    // Create a fresh public-profile author (privacy_level defaults to 'friends' on register;
    // explicitly set to 'public' here so strangers can browse their wall)
    const authPub = await registerVerified(request, randomEmail('bpubauthor'));
    setPrivacyLevel(authPub.user.id, 'public');

    const authStranger = await registerVerified(request, randomEmail('bpubstranger'));

    const post = await createPost(
      request, authPub.tokens.accessToken,
      `Public-profile public post B7b ${Date.now()}`, 'public',
    );

    const res = await request.get(`${BASE_URL}/api/users/${authPub.user.id}/posts`, {
      headers: authHeaders(authStranger.tokens.accessToken),
    });
    expect(res.status(), `GET /users/:pub/posts → expected 200, got ${res.status()}`).toBe(200);

    const body = (await res.json()) as { items: Array<{ id: string }> };
    const ids = body.items.map((i) => i.id);
    expect(
      ids,
      `Stranger must see public post ${post.id} from public-profile author`,
    ).toContain(post.id);
  });

});
