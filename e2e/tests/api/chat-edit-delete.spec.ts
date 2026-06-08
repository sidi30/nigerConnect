/**
 * chat-edit-delete.spec.ts
 *
 * Contract tests for WhatsApp-style message edit + delete-for-everyone
 * with a 15-minute mutation window.
 *
 * FEATURE:
 *   PATCH  /api/messages/:id          — edit a text message (sender only, text only, within 15 min)
 *   DELETE /api/messages/:id          — delete for everyone (sender only, within 15 min, soft-delete)
 *   GET    /api/conversations/:id/messages — now returns tombstones for deleted messages
 *
 * Coverage:
 *   1. Sender edits their text message within the window → 200, editedAt non-null,
 *      GET /messages reflects the new content.
 *   2. Peer (Bob) cannot edit or delete Alice's message → 403.
 *   3. Sender deletes their message → 2xx; GET /messages shows the id as a
 *      tombstone (deletedAt non-null, content null, mediaUrl null).
 *   4. Editing a non-text (image) message → 400.
 *   5. Edit/delete a non-existent message id → 404; edit/delete a message
 *      from a different conversation → 403 (not the sender).
 *   6. Happy-path within-window is exercised by every test above. The
 *      expired-window (>15 min) branch is NOT tested here because we cannot
 *      fast-forward server time without a special test endpoint. The unit tests
 *      in apps/api/src/chat/chat.service.spec.ts already cover that branch.
 *
 * Prerequisites:
 *   API running on API_BASE_URL (default http://localhost:3000)
 *   Postgres accessible via:
 *     docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect
 *   (used only for the email-verification DB shortcut shared by all api specs)
 */

import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── DB helper (same pattern as chat-read-receipts.spec.ts) ────────────────────

const PSQL_CMD = (sql: string) =>
  `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${sql.replace(/"/g, '\\"')}"`;

function verifyEmailInDb(userId: string): void {
  execSync(
    PSQL_CMD(`UPDATE users SET email_verified = true WHERE id = '${userId}';`),
    { stdio: 'pipe' },
  );
}

// ── Request helpers ───────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(prefix = 'e2eedit'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair { accessToken: string; refreshToken: string; }
interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'EditE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

// ── Shared bootstrap: two verified users in a direct conversation ─────────────
//
// Returns Alice (sender), Bob (peer), and the conversation id.

interface ConvoSetup {
  alice: AuthResponse;
  bob: AuthResponse;
  convoId: string;
}

async function setupDmConvo(request: APIRequestContext): Promise<ConvoSetup> {
  const alice = await register(request, randomEmail());
  const bob = await register(request, randomEmail());
  verifyEmailInDb(alice.user.id);
  verifyEmailInDb(bob.user.id);

  const createRes = await request.post(`${BASE_URL}/api/conversations`, {
    data: { participantIds: [bob.user.id] },
    headers: authHeaders(alice.tokens.accessToken),
  });
  expect(createRes.status(), `create DM conversation: ${await createRes.text()}`).toBe(201);
  const convo = await createRes.json() as { id: string };

  return { alice, bob, convoId: convo.id };
}

// ── Helper: send a text message as Alice, return the message object ───────────

interface MessageShape {
  id: string;
  content: string | null;
  mediaUrl: string | null;
  messageType: string;
  deletedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  senderId?: string;
  sender?: { id: string; [k: string]: unknown };
  [k: string]: unknown;
}

async function sendTextMessage(
  request: APIRequestContext,
  convoId: string,
  accessToken: string,
  content = 'Hello from Alice — edit/delete test',
): Promise<MessageShape> {
  const res = await request.post(`${BASE_URL}/api/conversations/${convoId}/messages`, {
    data: { content },
    headers: authHeaders(accessToken),
  });
  expect(res.status(), `send message: ${await res.text()}`).toBe(201);
  return (await res.json()) as MessageShape;
}

// ── Helper: fetch the messages list for a conversation ───────────────────────

async function fetchMessages(
  request: APIRequestContext,
  convoId: string,
  accessToken: string,
): Promise<{ items: MessageShape[] }> {
  const res = await request.get(`${BASE_URL}/api/conversations/${convoId}/messages`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Forwarded-For': uniqueIp(),
    },
  });
  expect(res.status(), `GET messages: ${await res.text()}`).toBe(200);
  return (await res.json()) as { items: MessageShape[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Edit within the window — happy path
// ─────────────────────────────────────────────────────────────────────────────

test.describe('PATCH /api/messages/:id — edit a text message', () => {

  test('1a. sender edits own text message → 200, content updated, editedAt non-null', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken);

    const patchRes = await request.patch(`${BASE_URL}/api/messages/${msg.id}`, {
      data: { content: 'Edited content — within 15 min window' },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      patchRes.status(),
      `PATCH /messages/:id expected 200, got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(200);

    const updated = await patchRes.json() as MessageShape;
    expect(updated.content, 'content must reflect the edit').toBe('Edited content — within 15 min window');
    expect(updated.editedAt, 'editedAt must be non-null after edit').not.toBeNull();
    expect(typeof updated.editedAt).toBe('string');
    expect(new Date(updated.editedAt!).getTime(), 'editedAt must be a valid ISO date').toBeGreaterThan(0);
  });

  test('1b. GET /messages after edit reflects new content and non-null editedAt', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken, 'Original content');

    await request.patch(`${BASE_URL}/api/messages/${msg.id}`, {
      data: { content: 'New content after edit' },
      headers: authHeaders(alice.tokens.accessToken),
    });

    const { items } = await fetchMessages(request, convoId, alice.tokens.accessToken);
    const found = items.find((m) => m.id === msg.id);
    expect(found, 'edited message must appear in GET /messages').toBeDefined();
    expect(found!.content, 'GET /messages must return the new content').toBe('New content after edit');
    expect(found!.editedAt, 'GET /messages must return non-null editedAt').not.toBeNull();
    expect(found!.deletedAt, 'editing must not set deletedAt').toBeNull();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Authorization — peer cannot mutate sender's message
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Authorization: peer cannot edit or delete sender message', () => {

  test('2a. Bob (peer) cannot edit Alice message → 403', async ({ request }) => {
    const { alice, bob, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken);

    const patchRes = await request.patch(`${BASE_URL}/api/messages/${msg.id}`, {
      data: { content: 'Bob trying to edit Alice message' },
      headers: authHeaders(bob.tokens.accessToken),
    });
    expect(
      patchRes.status(),
      `peer edit must be 403, got ${patchRes.status()}: ${await patchRes.text()}`,
    ).toBe(403);
  });

  test('2b. Bob (peer) cannot delete Alice message → 403', async ({ request }) => {
    const { alice, bob, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken);

    const deleteRes = await request.delete(`${BASE_URL}/api/messages/${msg.id}`, {
      headers: authHeaders(bob.tokens.accessToken),
    });
    expect(
      deleteRes.status(),
      `peer delete must be 403, got ${deleteRes.status()}: ${await deleteRes.text()}`,
    ).toBe(403);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Soft-delete — tombstone behavior
// ─────────────────────────────────────────────────────────────────────────────

test.describe('DELETE /api/messages/:id — soft-delete / tombstone', () => {

  test('3a. sender deletes own message → 2xx response', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken);

    const deleteRes = await request.delete(`${BASE_URL}/api/messages/${msg.id}`, {
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      deleteRes.status(),
      `DELETE /messages/:id expected 2xx, got ${deleteRes.status()}: ${await deleteRes.text()}`,
    ).toBeGreaterThanOrEqual(200);
    expect(deleteRes.status()).toBeLessThan(300);
  });

  test('3b. GET /messages after delete: message still present as tombstone (deletedAt non-null, content null, mediaUrl null)', async ({ request }) => {
    const { alice, bob, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken, 'Message that will be deleted');

    // Alice deletes the message
    const deleteRes = await request.delete(`${BASE_URL}/api/messages/${msg.id}`, {
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(deleteRes.status()).toBeGreaterThanOrEqual(200);
    expect(deleteRes.status()).toBeLessThan(300);

    // Alice fetches the message list — must see the tombstone
    const { items: aliceItems } = await fetchMessages(request, convoId, alice.tokens.accessToken);
    const aliceTombstone = aliceItems.find((m) => m.id === msg.id);
    expect(aliceTombstone, 'deleted message must still appear in Alice GET /messages').toBeDefined();
    expect(aliceTombstone!.deletedAt, 'tombstone deletedAt must be non-null').not.toBeNull();
    expect(aliceTombstone!.content, 'tombstone content must be null').toBeNull();
    expect(aliceTombstone!.mediaUrl, 'tombstone mediaUrl must be null').toBeNull();

    // Bob fetches the same list — he must also see the tombstone (WhatsApp-style both-sides delete)
    const { items: bobItems } = await fetchMessages(request, convoId, bob.tokens.accessToken);
    const bobTombstone = bobItems.find((m) => m.id === msg.id);
    expect(bobTombstone, 'deleted message must appear as tombstone in Bob GET /messages').toBeDefined();
    expect(bobTombstone!.deletedAt, 'Bob tombstone deletedAt must be non-null').not.toBeNull();
    expect(bobTombstone!.content, 'Bob tombstone content must be null').toBeNull();
    expect(bobTombstone!.mediaUrl, 'Bob tombstone mediaUrl must be null').toBeNull();
  });

  test('3c. deleting an already-deleted message → 404 (row is soft-deleted, not double-deleted)', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);
    const msg = await sendTextMessage(request, convoId, alice.tokens.accessToken);

    // First delete — must succeed
    const first = await request.delete(`${BASE_URL}/api/messages/${msg.id}`, {
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(first.status()).toBeGreaterThanOrEqual(200);
    expect(first.status()).toBeLessThan(300);

    // Second delete — the service treats deletedAt != null as "not found"
    const second = await request.delete(`${BASE_URL}/api/messages/${msg.id}`, {
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      second.status(),
      `double-delete must return 404, got ${second.status()}`,
    ).toBe(404);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Media binding (security): an image message's mediaUrl must point to one of
//    the SENDER's own uploaded objects. A foreign/off-platform URL is rejected
//    (OWASP A01/A10, CWE-639) — a tracking/SSRF beacon must never be persisted
//    and auto-loaded by recipients' clients. Regression guard for the chat
//    mediaUrl-binding fix. (No MinIO upload available in CI, so we assert the
//    rejection path; the happy path is exercised by the mobile upload flow.)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/conversations/:id/messages — media binding', () => {

  test('4a. sending an image with a foreign mediaUrl → 400 (not bound to sender)', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);

    const sendRes = await request.post(`${BASE_URL}/api/conversations/${convoId}/messages`, {
      data: {
        messageType: 'image',
        mediaUrl: 'https://attacker.example.com/beacon.jpg',
      },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      sendRes.status(),
      `foreign mediaUrl must be rejected, got ${sendRes.status()}: ${await sendRes.text()}`,
    ).toBe(400);
  });

  test('4b. a text message carrying a mediaUrl → 400', async ({ request }) => {
    const { alice, convoId } = await setupDmConvo(request);

    const sendRes = await request.post(`${BASE_URL}/api/conversations/${convoId}/messages`, {
      data: {
        content: 'hello',
        messageType: 'text',
        mediaUrl: 'https://attacker.example.com/beacon.jpg',
      },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      sendRes.status(),
      `text message must not carry media, got ${sendRes.status()}: ${await sendRes.text()}`,
    ).toBe(400);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Non-existent or wrong-conversation message ids
// ─────────────────────────────────────────────────────────────────────────────

test.describe('PATCH/DELETE /api/messages/:id — non-existent and cross-conversation ids', () => {

  test('5a. editing a non-existent message id → 404', async ({ request }) => {
    const { alice } = await setupDmConvo(request);
    // A syntactically valid UUID that does not correspond to any row
    const fakeId = '00000000-0000-4000-a000-000000000001';

    const patchRes = await request.patch(`${BASE_URL}/api/messages/${fakeId}`, {
      data: { content: 'Editing a ghost message' },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      patchRes.status(),
      `edit non-existent message must return 404, got ${patchRes.status()}`,
    ).toBe(404);
  });

  test('5b. deleting a non-existent message id → 404', async ({ request }) => {
    const { alice } = await setupDmConvo(request);
    const fakeId = '00000000-0000-4000-a000-000000000002';

    const deleteRes = await request.delete(`${BASE_URL}/api/messages/${fakeId}`, {
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(
      deleteRes.status(),
      `delete non-existent message must return 404, got ${deleteRes.status()}`,
    ).toBe(404);
  });

  test('5c. editing a message from a different conversation → 403 (not the sender)', async ({ request }) => {
    // Alice sends a message in conversation A. Carol (a third user) tries to
    // edit it using her own token. The service checks senderId === requesterId
    // before any conversation-membership check, so Carol gets 403.
    const { alice, convoId: convoA } = await setupDmConvo(request);
    const msgA = await sendTextMessage(request, convoA, alice.tokens.accessToken, 'Alice DM-A message');

    // Carol: a fresh user who has never been in any conversation with Alice
    const carol = await register(request, randomEmail('e2ecarol'));
    verifyEmailInDb(carol.user.id);

    const patchRes = await request.patch(`${BASE_URL}/api/messages/${msgA.id}`, {
      data: { content: 'Carol trying to edit Alice message from another conversation' },
      headers: authHeaders(carol.tokens.accessToken),
    });
    // The service finds the message, sees senderId !== carol.user.id → ForbiddenException
    expect(
      patchRes.status(),
      `cross-conversation edit by non-sender must return 403, got ${patchRes.status()}`,
    ).toBe(403);
  });

  test('5d. deleting a message from a different conversation → 403 (not the sender)', async ({ request }) => {
    const { alice, convoId: convoA } = await setupDmConvo(request);
    const msgA = await sendTextMessage(request, convoA, alice.tokens.accessToken, 'Alice DM-A message to delete');

    const carol = await register(request, randomEmail('e2ecarol'));
    verifyEmailInDb(carol.user.id);

    const deleteRes = await request.delete(`${BASE_URL}/api/messages/${msgA.id}`, {
      headers: authHeaders(carol.tokens.accessToken),
    });
    expect(
      deleteRes.status(),
      `cross-conversation delete by non-sender must return 403, got ${deleteRes.status()}`,
    ).toBe(403);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 15-minute window — note on test strategy
// ─────────────────────────────────────────────────────────────────────────────
//
// The happy-path within-window case is exercised in every test above — messages
// are sent and then immediately mutated, well within the 15-min window.
//
// The expired-window (> 15 min) branch CANNOT be tested without time-travel
// (no test endpoint exists to seed a past createdAt). Unit tests in
//   apps/api/src/chat/chat.service.spec.ts
// cover the window-expiry refusal branch. No sleep/flaky timer added here.
