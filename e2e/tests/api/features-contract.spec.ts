/**
 * features-contract.spec.ts
 *
 * Contract tests for three newly shipped features:
 *   1. PAGES    — create, list, follow/unfollow, update, delete, admins
 *   2. POLLS    — create (page/standalone), vote (single/multi), retract, delete
 *   3. REVIEWS  — upsert, summary, page review, delete
 *   4. NOTIFICATIONS — 24h expiry, delete, clear-all, device register/delete
 *
 * Prerequisites:
 *   API running on http://127.0.0.1:3000
 *   Postgres on localhost:5433 (nigerconnect/nigerconnect/nigerconnect)
 *   Docker container: nigerconnect-postgres (for psql mutations)
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

function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2efeatures+${ts}${rand}@nigerconnect.test`;
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
    data: { email, password: VALID_PASSWORD, firstName: 'FeatE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} -> expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function approveIdentityInDb(userId: string): void {
  psql(`UPDATE users SET identity_status = 'approved' WHERE id = '${userId}';`);
}

/** Register + verify email + approve identity. Re-login so JWT reflects DB state. */
async function registerApproved(request: APIRequestContext) {
  const email = randomEmail();
  const { user, tokens } = await register(request, email);
  verifyEmailInDb(user.id);
  approveIdentityInDb(user.id);
  // Re-login so the token is fresh (API currently checks DB not JWT claim — kept for defence).
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: VALID_PASSWORD },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(loginRes.status()).toBe(200);
  const loginBody = (await loginRes.json()) as AuthResponse;
  return { user, tokens: loginBody.tokens };
}

/** Register + verify email only (no identity approval). */
async function registerVerified(request: APIRequestContext) {
  const email = randomEmail();
  const { user, tokens } = await register(request, email);
  verifyEmailInDb(user.id);
  return { user, tokens };
}

/**
 * Returns authenticated JSON headers with a fresh unique X-Forwarded-For IP.
 * Using a unique IP per request avoids the 10 req/s global throttle when
 * many tests run in parallel from the same loopback address.
 */
function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

// ── 1. PAGES ─────────────────────────────────────────────────────────────────

test.describe('Pages', () => {
  test('POST /api/pages with identity-approved user -> 201, followerCount=1, kind echoed', async ({ request }) => {
    const { tokens } = await registerApproved(request);
    const name = `E2EPage-${Date.now()}`;
    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: { name, kind: 'cause', description: 'E2E test page', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), `create page: ${await res.text()}`).toBe(201);
    const body = await res.json() as { id: string; kind: string; followerCount: number };
    expect(typeof body.id).toBe('string');
    expect(body.kind).toBe('cause');
    expect(body.followerCount).toBe(1);
  });

  test('POST /api/pages with NON-approved identity user -> 403', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-NotApproved-${Date.now()}`, kind: 'community', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/pages -> 200 cursor page; created page present; kind filter; q filter', async ({ request }) => {
    const { tokens } = await registerApproved(request);
    const uniqueSuffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const name = `E2EPage-List-${uniqueSuffix}`;
    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name, kind: 'business', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json() as { id: string };

    // List all -> page present
    const listRes = await request.get(`${BASE_URL}/api/pages`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(Array.isArray(listBody.items)).toBe(true);
    expect('nextCursor' in listBody).toBe(true);
    const found = listBody.items.some((p) => p.id === created.id);
    expect(found, 'created page must appear in list').toBe(true);

    // kind=business filter
    const kindRes = await request.get(`${BASE_URL}/api/pages?kind=business`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(kindRes.status()).toBe(200);
    const kindBody = await kindRes.json() as { items: Array<{ id: string; kind: string }> };
    const inKindList = kindBody.items.some((p) => p.id === created.id);
    expect(inKindList, 'page should appear in kind=business filter').toBe(true);

    // kind=cause should NOT contain our business page
    const wrongKindRes = await request.get(`${BASE_URL}/api/pages?kind=cause`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(wrongKindRes.status()).toBe(200);
    const wrongKindBody = await wrongKindRes.json() as { items: Array<{ id: string }> };
    const notInWrongKind = wrongKindBody.items.every((p) => p.id !== created.id);
    expect(notInWrongKind, 'business page must not appear in kind=cause filter').toBe(true);

    // q search using the unique suffix
    const qRes = await request.get(`${BASE_URL}/api/pages?q=${uniqueSuffix}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(qRes.status()).toBe(200);
    const qBody = await qRes.json() as { items: Array<{ id: string }> };
    const inQList = qBody.items.some((p) => p.id === created.id);
    expect(inQList, 'page should be found by q search with unique suffix').toBe(true);
  });

  test('GET /api/pages/:id as creator -> isFollowing=true, myRole=admin', async ({ request }) => {
    const { tokens } = await registerApproved(request);
    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Detail-${Date.now()}`, kind: 'community', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json() as { id: string };

    const getRes = await request.get(`${BASE_URL}/api/pages/${created.id}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json() as { isFollowing: boolean; myRole: string };
    expect(body.isFollowing).toBe(true);
    expect(body.myRole).toBe('admin');
  });

  test('POST /api/pages/:id/follow by second user -> {following:true}; followerCount=2; isFollowing=true; 409 on duplicate', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: secondTokens } = await registerVerified(request);

    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Follow-${Date.now()}`, kind: 'group', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const page = await createRes.json() as { id: string };

    // Second user follows
    const followRes = await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${secondTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(followRes.status()).toBe(201);
    const followBody = await followRes.json() as { following: boolean };
    expect(followBody.following).toBe(true);

    // GET shows followerCount=2 and second user's isFollowing=true
    const getRes = await request.get(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${secondTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json() as { followerCount: number; isFollowing: boolean };
    expect(getBody.followerCount).toBe(2);
    expect(getBody.isFollowing).toBe(true);

    // Following again -> 409
    const dupRes = await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${secondTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(dupRes.status()).toBe(409);
  });

  test('DELETE /api/pages/:id/follow by second user -> 204; followerCount back to 1', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: secondTokens } = await registerVerified(request);

    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Unfollow-${Date.now()}`, kind: 'official', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const page = await createRes.json() as { id: string };

    // Second user follows
    await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${secondTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });

    // Verify followerCount is 2
    const beforeUnfollow = await request.get(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    const beforeBody = await beforeUnfollow.json() as { followerCount: number };
    expect(beforeBody.followerCount).toBe(2);

    // Unfollow -> 204
    const unfollowRes = await request.delete(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${secondTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(unfollowRes.status()).toBe(204);

    // followerCount back to 1
    const afterRes = await request.get(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    const afterBody = await afterRes.json() as { followerCount: number };
    expect(afterBody.followerCount).toBe(1);
  });

  test('PATCH /api/pages/:id by non-admin -> 403; by creator -> 200', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: otherTokens } = await registerVerified(request);

    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Update-${Date.now()}`, kind: 'community', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const page = await createRes.json() as { id: string };

    // Non-admin tries to update -> 403
    const badRes = await request.patch(`${BASE_URL}/api/pages/${page.id}`, {
      data: { description: 'Hacked description' },
      headers: authHeaders(otherTokens.accessToken),
    });
    expect(badRes.status()).toBe(403);

    // Creator updates -> 200
    const goodRes = await request.patch(`${BASE_URL}/api/pages/${page.id}`, {
      data: { description: 'Updated description' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(goodRes.status()).toBe(200);
    const updBody = await goodRes.json() as { description: string };
    expect(updBody.description).toBe('Updated description');
  });

  test('GET /api/pages/:id/admins -> contains creator as admin', async ({ request }) => {
    const { user, tokens } = await registerApproved(request);

    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Admins-${Date.now()}`, kind: 'cause', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const page = await createRes.json() as { id: string };

    const adminsRes = await request.get(`${BASE_URL}/api/pages/${page.id}/admins`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(adminsRes.status()).toBe(200);
    const adminsBody = await adminsRes.json() as Array<{ user: { id: string }; role: string }>;
    expect(Array.isArray(adminsBody)).toBe(true);
    const creatorInList = adminsBody.some((a) => a.user.id === user.id && a.role === 'admin');
    expect(creatorInList, 'creator must appear in admins list as admin').toBe(true);
  });

  test('DELETE /api/pages/:id by non-admin -> 403; by admin -> 204; GET -> 404', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: otherTokens } = await registerVerified(request);

    const createRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `E2EPage-Delete-${Date.now()}`, kind: 'group', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const page = await createRes.json() as { id: string };

    // Non-admin delete -> 403
    const badDel = await request.delete(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${otherTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(badDel.status()).toBe(403);

    // Creator deletes -> 204
    const delRes = await request.delete(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(delRes.status()).toBe(204);

    // GET after delete -> 404
    const getRes = await request.get(`${BASE_URL}/api/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${creatorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(404);
  });
});

// ── 2. POLLS ─────────────────────────────────────────────────────────────────

test.describe('Polls', () => {
  test('Page admin POST /api/polls -> 201 with 3 options, voteCount=0, closed=false, myVotes=[]', async ({ request }) => {
    const { tokens } = await registerApproved(request);

    // Create a page first
    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `PollPage-${Date.now()}`, kind: 'community', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    // Create poll attached to the page
    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Which option?', options: ['Alpha', 'Beta', 'Gamma'], pageId: page.id },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status(), `create poll: ${await pollRes.text()}`).toBe(201);
    const poll = await pollRes.json() as {
      id: string;
      question: string;
      options: Array<{ id: string; label: string; voteCount: number }>;
      voteCount: number;
      closed: boolean;
      myVotes: string[];
    };
    expect(poll.question).toBe('Which option?');
    expect(poll.options).toHaveLength(3);
    expect(poll.voteCount).toBe(0);
    expect(poll.closed).toBe(false);
    expect(poll.myVotes).toEqual([]);
  });

  test('POST /api/polls with pageId by a NON-admin of that page -> 403', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: nonAdminTokens } = await registerVerified(request);

    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `PollPage-NonAdmin-${Date.now()}`, kind: 'group', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Unauthorized poll?', options: ['Yes', 'No'], pageId: page.id },
      headers: authHeaders(nonAdminTokens.accessToken),
    });
    expect(pollRes.status()).toBe(403);
  });

  test('Standalone poll (no pageId) by any verified user -> 201', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Standalone poll?', options: ['Oui', 'Non'] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status(), `standalone poll: ${await pollRes.text()}`).toBe(201);
    const poll = await pollRes.json() as { id: string; pageId: unknown };
    expect(typeof poll.id).toBe('string');
    expect(poll.pageId).toBeNull();
  });

  test('POST /api/polls/:id/vote single-choice -> option voteCount=1, poll voteCount=1, myVotes=[optA]', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Vote test?', options: ['OptionA', 'OptionB', 'OptionC'] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as {
      id: string;
      options: Array<{ id: string; label: string; voteCount: number }>;
    };
    const optA = poll.options[0]!;

    const voteRes = await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [optA.id] },
      headers: authHeaders(tokens.accessToken),
    });
    // The vote endpoint has no @HttpCode decorator so NestJS returns 201 for POST.
    expect([200, 201]).toContain(voteRes.status());
    const voteBody = await voteRes.json() as {
      voteCount: number;
      myVotes: string[];
      options: Array<{ id: string; voteCount: number }>;
    };
    expect(voteBody.voteCount).toBe(1);
    expect(voteBody.myVotes).toContain(optA.id);
    const optAResult = voteBody.options.find((o) => o.id === optA.id);
    expect(optAResult?.voteCount).toBe(1);
  });

  test('Re-vote single-choice: optB replaces optA; optA back to 0, optB=1, poll voteCount stays 1', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Re-vote test?', options: ['OptA', 'OptB'] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as {
      id: string;
      options: Array<{ id: string; label: string; voteCount: number }>;
    };
    const optA = poll.options[0]!;
    const optB = poll.options[1]!;

    // First vote: optA
    await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [optA.id] },
      headers: authHeaders(tokens.accessToken),
    });

    // Re-vote: optB (replace)
    const revoteRes = await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [optB.id] },
      headers: authHeaders(tokens.accessToken),
    });
    // POST /vote has no @HttpCode so NestJS returns 201 by default.
    expect([200, 201]).toContain(revoteRes.status());
    const revoteBody = await revoteRes.json() as {
      voteCount: number;
      myVotes: string[];
      options: Array<{ id: string; voteCount: number }>;
    };
    expect(revoteBody.voteCount).toBe(1);
    expect(revoteBody.myVotes).toContain(optB.id);
    expect(revoteBody.myVotes).not.toContain(optA.id);
    const optAResult = revoteBody.options.find((o) => o.id === optA.id);
    const optBResult = revoteBody.options.find((o) => o.id === optB.id);
    expect(optAResult?.voteCount).toBe(0);
    expect(optBResult?.voteCount).toBe(1);
  });

  test('Single-choice vote with 2 optionIds -> 400', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Single choice only', options: ['A', 'B', 'C'] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as { id: string; options: Array<{ id: string }> };

    const badVoteRes = await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [poll.options[0]!.id, poll.options[1]!.id] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(badVoteRes.status()).toBe(400);
  });

  test('Multi-choice poll: vote [optA, optB] -> both counted; voteCount (distinct voters) = 1', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Multi choice test?', options: ['Alpha', 'Beta', 'Gamma'], multiChoice: true },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as {
      id: string;
      multiChoice: boolean;
      options: Array<{ id: string; label: string }>;
    };
    expect(poll.multiChoice).toBe(true);

    const optA = poll.options[0]!;
    const optB = poll.options[1]!;

    const voteRes = await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [optA.id, optB.id] },
      headers: authHeaders(tokens.accessToken),
    });
    // POST /vote has no @HttpCode so NestJS returns 201 by default.
    expect([200, 201]).toContain(voteRes.status());
    const voteBody = await voteRes.json() as {
      voteCount: number;
      myVotes: string[];
      options: Array<{ id: string; voteCount: number }>;
    };
    // Distinct voters = 1
    expect(voteBody.voteCount).toBe(1);
    expect(voteBody.myVotes).toContain(optA.id);
    expect(voteBody.myVotes).toContain(optB.id);
    const optAResult = voteBody.options.find((o) => o.id === optA.id);
    const optBResult = voteBody.options.find((o) => o.id === optB.id);
    expect(optAResult?.voteCount).toBe(1);
    expect(optBResult?.voteCount).toBe(1);
  });

  test('DELETE /api/polls/:id by author -> 204; GET -> 404; DELETE by stranger -> 403', async ({ request }) => {
    const { tokens: authorTokens } = await registerVerified(request);
    const { tokens: strangerTokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Delete test?', options: ['Yes', 'No'] },
      headers: authHeaders(authorTokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as { id: string };

    // Stranger tries to delete -> 403
    const strangerDel = await request.delete(`${BASE_URL}/api/polls/${poll.id}`, {
      headers: { Authorization: `Bearer ${strangerTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(strangerDel.status()).toBe(403);

    // Author deletes -> 204
    const authorDel = await request.delete(`${BASE_URL}/api/polls/${poll.id}`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(authorDel.status()).toBe(204);

    // GET -> 404
    const getRes = await request.get(`${BASE_URL}/api/polls/${poll.id}`, {
      headers: { Authorization: `Bearer ${authorTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(404);
  });

  test('DELETE /api/polls/:id/vote -> 204 then myVotes=[] and counts decremented', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Retract vote test?', options: ['One', 'Two'] },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as { id: string; options: Array<{ id: string }> };
    const optOne = poll.options[0]!;

    // Vote first
    await request.post(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      data: { optionIds: [optOne.id] },
      headers: authHeaders(tokens.accessToken),
    });

    // Retract vote -> 204
    const retractRes = await request.delete(`${BASE_URL}/api/polls/${poll.id}/vote`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(retractRes.status()).toBe(204);

    // GET: myVotes=[] and counts=0
    const getRes = await request.get(`${BASE_URL}/api/polls/${poll.id}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json() as {
      voteCount: number;
      myVotes: string[];
      options: Array<{ id: string; voteCount: number }>;
    };
    expect(getBody.myVotes).toEqual([]);
    expect(getBody.voteCount).toBe(0);
    const optOneResult = getBody.options.find((o) => o.id === optOne.id);
    expect(optOneResult?.voteCount).toBe(0);
  });

  test('Poll with expiresInHours: closed=false and expiresAt not null', async ({ request }) => {
    const { tokens } = await registerVerified(request);

    const pollRes = await request.post(`${BASE_URL}/api/polls`, {
      data: { question: 'Not closed yet?', options: ['Yes', 'No'], expiresInHours: 48 },
      headers: authHeaders(tokens.accessToken),
    });
    expect(pollRes.status()).toBe(201);
    const poll = await pollRes.json() as { closed: boolean; expiresAt: string | null };
    expect(poll.closed).toBe(false);
    expect(poll.expiresAt).not.toBeNull();
  });
});

// ── 3. REVIEWS ───────────────────────────────────────────────────────────────

test.describe('Reviews', () => {
  test('User B reviews user A -> 201; summary shows ratingAvg=4, ratingCount=1, distribution[3]=1, myReview present', async ({ request }) => {
    const { user: userA } = await registerVerified(request);
    const { tokens: tokensB } = await registerVerified(request);

    const reviewRes = await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 4, comment: 'Great user!' },
      headers: authHeaders(tokensB.accessToken),
    });
    expect(reviewRes.status(), `upsert review: ${await reviewRes.text()}`).toBe(201);
    const review = await reviewRes.json() as { id: string; rating: number };
    expect(review.rating).toBe(4);

    const summaryRes = await request.get(`${BASE_URL}/api/reviews/user/${userA.id}/summary`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as {
      ratingAvg: number;
      ratingCount: number;
      distribution: number[];
      myReview: { id: string; rating: number } | null;
    };
    expect(summary.ratingAvg).toBe(4);
    expect(summary.ratingCount).toBe(1);
    // distribution is 0-indexed: index 3 = 4-star
    expect(summary.distribution[3]).toBe(1);
    expect(summary.myReview).not.toBeNull();
    expect(summary.myReview?.rating).toBe(4);
  });

  test('B re-reviews userA (upsert) with rating:2 -> ratingCount stays 1, ratingAvg=2', async ({ request }) => {
    const { user: userA } = await registerVerified(request);
    const { tokens: tokensB } = await registerVerified(request);

    // First review: rating 4
    await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 4 },
      headers: authHeaders(tokensB.accessToken),
    });

    // Upsert with new rating: 2
    const upsertRes = await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 2 },
      headers: authHeaders(tokensB.accessToken),
    });
    expect(upsertRes.status()).toBe(201);

    const summaryRes = await request.get(`${BASE_URL}/api/reviews/user/${userA.id}/summary`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as { ratingAvg: number; ratingCount: number };
    expect(summary.ratingCount).toBe(1);
    expect(summary.ratingAvg).toBe(2);
  });

  test('Two reviewers B and C -> ratingCount=2, avg=3.5', async ({ request }) => {
    const { user: userA } = await registerVerified(request);
    const { tokens: tokensB } = await registerVerified(request);
    const { tokens: tokensC } = await registerVerified(request);

    // B rates 2
    await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 2 },
      headers: authHeaders(tokensB.accessToken),
    });

    // C rates 5
    await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 5 },
      headers: authHeaders(tokensC.accessToken),
    });

    const summaryRes = await request.get(`${BASE_URL}/api/reviews/user/${userA.id}/summary`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as { ratingAvg: number; ratingCount: number };
    expect(summary.ratingCount).toBe(2);
    expect(summary.ratingAvg).toBe(3.5);
  });

  test('Self-review -> 400', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await registerVerified(request);

    const res = await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 5 },
      headers: authHeaders(tokensA.accessToken),
    });
    expect(res.status()).toBe(400);
  });

  test('Public profile GET /api/profile/:id reflects ratingAvg and ratingCount', async ({ request }) => {
    const { user: userA } = await registerVerified(request);
    const { user: userB, tokens: tokensB } = await registerVerified(request);

    // B reviews A with rating 5
    await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 5 },
      headers: authHeaders(tokensB.accessToken),
    });

    // Verify via summary endpoint
    const summaryRes = await request.get(`${BASE_URL}/api/reviews/user/${userA.id}/summary`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as { ratingAvg: number; ratingCount: number };
    expect(summary.ratingAvg).toBe(5);
    expect(summary.ratingCount).toBe(1);

    // Also verify via the public profile endpoint
    const profileRes = await request.get(`${BASE_URL}/api/profile/${userA.id}`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(profileRes.status()).toBe(200);
    const profileBody = await profileRes.json() as { user: Record<string, unknown> };
    // ratingAvg and ratingCount should be present on the serialized user object
    expect(typeof profileBody.user['ratingAvg']).toBe('number');
    expect(typeof profileBody.user['ratingCount']).toBe('number');
    expect(profileBody.user['ratingAvg']).toBe(5);
    expect(profileBody.user['ratingCount']).toBe(1);

    void userB;
  });

  test('Page review: POST /api/reviews {targetType:page} -> 201; summary ratingCount=1', async ({ request }) => {
    const { tokens: creatorTokens } = await registerApproved(request);
    const { tokens: reviewerTokens } = await registerVerified(request);

    // Create a page
    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `ReviewPage-${Date.now()}`, kind: 'business', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(creatorTokens.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    // Review the page
    const reviewRes = await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'page', targetId: page.id, rating: 5, comment: 'Great page!' },
      headers: authHeaders(reviewerTokens.accessToken),
    });
    expect(reviewRes.status(), `page review: ${await reviewRes.text()}`).toBe(201);

    // Summary
    const summaryRes = await request.get(`${BASE_URL}/api/reviews/page/${page.id}/summary`, {
      headers: { Authorization: `Bearer ${reviewerTokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as { ratingCount: number; ratingAvg: number };
    expect(summary.ratingCount).toBe(1);
    expect(summary.ratingAvg).toBe(5);
  });

  test('DELETE /api/reviews/:id by author -> 204; ratingCount decremented; DELETE by stranger -> 403', async ({ request }) => {
    const { user: userA } = await registerVerified(request);
    const { tokens: tokensB } = await registerVerified(request);
    const { tokens: tokensStranger } = await registerVerified(request);

    // B reviews A
    const reviewRes = await request.post(`${BASE_URL}/api/reviews`, {
      data: { targetType: 'user', targetId: userA.id, rating: 3 },
      headers: authHeaders(tokensB.accessToken),
    });
    expect(reviewRes.status()).toBe(201);
    const review = await reviewRes.json() as { id: string };

    // Stranger tries to delete -> 403
    const strangerDel = await request.delete(`${BASE_URL}/api/reviews/${review.id}`, {
      headers: { Authorization: `Bearer ${tokensStranger.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(strangerDel.status()).toBe(403);

    // Author deletes -> 204
    const authorDel = await request.delete(`${BASE_URL}/api/reviews/${review.id}`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(authorDel.status()).toBe(204);

    // Summary: ratingCount decremented to 0
    const summaryRes = await request.get(`${BASE_URL}/api/reviews/user/${userA.id}/summary`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(summaryRes.status()).toBe(200);
    const summary = await summaryRes.json() as { ratingCount: number };
    expect(summary.ratingCount).toBe(0);
  });
});

// ── 4. NOTIFICATIONS ─────────────────────────────────────────────────────────

test.describe('Notifications', () => {
  test('After B follows A page, A gets a page_follow notification with expiresAt ~24h ahead', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await registerApproved(request);
    const { tokens: tokensB } = await registerVerified(request);

    // A creates a page
    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `NotifPage-${Date.now()}`, kind: 'community', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokensA.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    // B follows A's page (triggers notification to A)
    const followRes = await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(followRes.status()).toBe(201);

    // Poll A's notifications up to 3 times (notification delivery is synchronous but
    // the list endpoint purges expired rows on read — we just retry defensively).
    let notifFound = false;
    let notifId: string | undefined;
    let expiresAt: string | null = null;

    for (let attempt = 0; attempt < 3 && !notifFound; attempt++) {
      const notifRes = await request.get(`${BASE_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
      });
      expect(notifRes.status()).toBe(200);
      const notifBody = await notifRes.json() as {
        items: Array<{ id: string; type: string; expiresAt: string | null }>;
      };
      const pageFollowNotif = notifBody.items.find((n) => n.type === 'page_follow');
      if (pageFollowNotif) {
        notifFound = true;
        notifId = pageFollowNotif.id;
        expiresAt = pageFollowNotif.expiresAt;
      }
    }

    expect(notifFound, 'A should have a page_follow notification').toBe(true);
    expect(expiresAt, 'notification expiresAt should not be null').not.toBeNull();

    // expiresAt should be ~24h ahead (between 23h and 25h from now)
    const expiresMs = new Date(expiresAt!).getTime();
    const nowMs = Date.now();
    const diffHours = (expiresMs - nowMs) / 3_600_000;
    expect(diffHours, `expiresAt should be ~24h ahead, got ${diffHours.toFixed(2)}h`).toBeGreaterThan(23);
    expect(diffHours, `expiresAt should be ~24h ahead, got ${diffHours.toFixed(2)}h`).toBeLessThan(25);

    void userA;
    void notifId;
  });

  test('DELETE /api/notifications/:id -> 204; item gone from list', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await registerApproved(request);
    const { tokens: tokensB } = await registerVerified(request);

    // Create a page so B can follow it and trigger a notification for A
    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `NotifDeletePage-${Date.now()}`, kind: 'cause', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokensA.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });

    // Get A's notifications and find the page_follow one
    const notifRes = await request.get(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(notifRes.status()).toBe(200);
    const notifBody = await notifRes.json() as {
      items: Array<{ id: string; type: string }>;
    };
    const notif = notifBody.items.find((n) => n.type === 'page_follow');
    expect(notif, 'should have at least one page_follow notification to delete').toBeDefined();

    // Delete it -> 204
    const delRes = await request.delete(`${BASE_URL}/api/notifications/${notif!.id}`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(delRes.status()).toBe(204);

    // Verify it's gone from list
    const afterRes = await request.get(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(afterRes.status()).toBe(200);
    const afterBody = await afterRes.json() as { items: Array<{ id: string }> };
    const stillThere = afterBody.items.some((n) => n.id === notif!.id);
    expect(stillThere, 'deleted notification must not appear in list').toBe(false);

    void userA;
  });

  test('DELETE /api/notifications/clear-all -> 204; GET list empty', async ({ request }) => {
    const { user: userA, tokens: tokensA } = await registerApproved(request);
    const { tokens: tokensB } = await registerVerified(request);

    // Create a page + follow to generate a notification for A
    const pageRes = await request.post(`${BASE_URL}/api/pages`, {
      data: { name: `NotifClearPage-${Date.now()}`, kind: 'group', countryCode: 'NE', city: 'Niamey' },
      headers: authHeaders(tokensA.accessToken),
    });
    expect(pageRes.status()).toBe(201);
    const page = await pageRes.json() as { id: string };

    await request.post(`${BASE_URL}/api/pages/${page.id}/follow`, {
      headers: { Authorization: `Bearer ${tokensB.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });

    // Clear all -> 204
    const clearRes = await request.delete(`${BASE_URL}/api/notifications/clear-all`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(clearRes.status()).toBe(204);

    // GET list must be empty
    const listRes = await request.get(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokensA.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json() as { items: unknown[] };
    expect(listBody.items).toHaveLength(0);

    void userA;
  });

  test('DELETE /api/notifications/device not shadowed by :id: register then delete device token -> 204', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const token = `e2e-device-token-${Date.now()}`;

    // Register device
    const regRes = await request.post(`${BASE_URL}/api/notifications/register-device`, {
      data: { token, platform: 'ios' },
      headers: authHeaders(tokens.accessToken),
    });
    expect(regRes.status(), `register device: ${await regRes.text()}`).toBe(204);

    // Delete device token (literal DELETE /device route, not shadowed by :id)
    const delRes = await request.delete(`${BASE_URL}/api/notifications/device`, {
      data: { token },
      headers: authHeaders(tokens.accessToken),
    });
    expect(delRes.status(), `delete device: ${await delRes.text()}`).toBe(204);
  });
});
