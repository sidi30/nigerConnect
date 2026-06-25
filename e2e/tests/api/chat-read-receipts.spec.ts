/**
 * chat-read-receipts.spec.ts
 *
 * Contract tests for chat read receipts (REST) and Socket.io events.
 *
 * FEATURE: read receipts + typing indicators (chat).
 *
 * REST coverage:
 *   - Two users (Alice, Bob) in a direct conversation
 *   - Alice sends a message via POST /api/conversations/:id/messages
 *   - Bob calls POST /api/conversations/:id/read (mark-read)
 *   - GET /api/conversations/:id includes membersMeta: [{ userId, lastReadAt, unreadCount }]
 *   - After Bob marks read → membersMeta entry for Bob.lastReadAt >= message.createdAt
 *   - Before Bob marks read → Bob.unreadCount > 0
 *   - After Bob marks read → Bob.unreadCount === 0
 *
 * Socket.io coverage (namespace /chat, auth via handshake.auth.token):
 *   - message:read broadcast {conversationId, userId, lastReadAt}
 *   - typing:start / typing:stop events {conversationId, userId}
 *   - message:new broadcast on send
 *
 * Socket tests require socket.io-client to be installed in the e2e package.
 * If socket.io-client is not resolvable, the socket tests are skipped with a
 * clear message. To enable them, add to e2e/package.json devDependencies:
 *   "socket.io-client": "^4.8.3"
 * then run: pnpm --filter @nigerconnect/e2e install
 *
 * Prerequisites:
 *   API running on API_BASE_URL (default http://localhost:3000)
 *   Postgres for email-verification DB mutations
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
// Derive WS URL from base URL: http://localhost:3000 → ws://localhost:3000
// (socket.io-client handles http:// → ws:// upgrade automatically)
const WS_URL = BASE_URL;
const VALID_PASSWORD = 'E2eTest#2026!z';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2echat+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair { accessToken: string; refreshToken: string; }
interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'ChatE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

// ── REST: membersMeta read-receipt assertions ─────────────────────────────────

test.describe('Chat read receipts — REST', () => {

  test('GET /api/conversations/:id membersMeta has correct shape after creation', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    // Alice creates a direct conversation with Bob
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status(), `create convo: ${await createRes.text()}`).toBe(201);
    const convo = await createRes.json() as { id: string };

    // GET conversation — check membersMeta shape
    const getRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${alice.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json() as {
      id: string;
      membersMeta: Array<{ userId: string; lastReadAt: string | null; unreadCount: number }>;
    };

    expect(Array.isArray(body.membersMeta), 'membersMeta must be an array').toBe(true);
    expect(body.membersMeta.length, 'membersMeta must have 2 entries for a direct convo').toBe(2);

    for (const meta of body.membersMeta) {
      expect(typeof meta.userId, 'each meta entry must have userId string').toBe('string');
      expect(typeof meta.unreadCount, 'each meta entry must have unreadCount number').toBe('number');
      // lastReadAt is null or ISO string
      const isValid = meta.lastReadAt === null || typeof meta.lastReadAt === 'string';
      expect(isValid, 'lastReadAt must be null or string').toBe(true);
    }

    // Both Alice and Bob must appear in membersMeta
    const aliceMeta = body.membersMeta.find((m) => m.userId === alice.user.id);
    const bobMeta = body.membersMeta.find((m) => m.userId === bob.user.id);
    expect(aliceMeta, 'Alice must be in membersMeta').toBeDefined();
    expect(bobMeta, 'Bob must be in membersMeta').toBeDefined();
  });

  test('Bob unreadCount increments after Alice sends a message', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    // Alice creates conversation with Bob
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    // Alice sends a message
    const msgRes = await request.post(`${BASE_URL}/api/conversations/${convo.id}/messages`, {
      data: { content: 'Hello Bob, this is a read-receipt test message' },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(msgRes.status()).toBe(201);

    // Bob checks the conversation — his unreadCount should be 1
    const getRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json() as {
      membersMeta: Array<{ userId: string; unreadCount: number }>;
    };

    const bobMeta = body.membersMeta.find((m) => m.userId === bob.user.id);
    expect(bobMeta, 'Bob must be in membersMeta').toBeDefined();
    expect(bobMeta!.unreadCount, 'Bob must have unreadCount >= 1 after Alice sent a message').toBeGreaterThanOrEqual(1);
  });

  test('Bob mark-read → membersMeta.lastReadAt >= message.createdAt, unreadCount=0', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    // Capture a timestamp BEFORE Alice sends the message
    const beforeSend = new Date();

    // Alice creates conversation + sends message
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    const msgRes = await request.post(`${BASE_URL}/api/conversations/${convo.id}/messages`, {
      data: { content: 'Test message for read-receipt check' },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(msgRes.status()).toBe(201);
    const message = await msgRes.json() as { id: string; createdAt: string };
    const messageCreatedAt = new Date(message.createdAt);

    // Verify message.createdAt is after our beforeSend timestamp (sanity check)
    expect(messageCreatedAt.getTime()).toBeGreaterThanOrEqual(beforeSend.getTime());

    // Bob calls mark-read
    const markReadRes = await request.post(
      `${BASE_URL}/api/conversations/${convo.id}/read`,
      { headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() } },
    );
    // POST /conversations/:id/read returns 204 No Content
    expect(markReadRes.status(), `mark-read expected 204, got ${markReadRes.status()}`).toBe(204);

    // GET conversation as Bob — check membersMeta
    const getRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json() as {
      membersMeta: Array<{ userId: string; lastReadAt: string | null; unreadCount: number }>;
    };

    const bobMeta = body.membersMeta.find((m) => m.userId === bob.user.id);
    expect(bobMeta, 'Bob must be in membersMeta').toBeDefined();

    // Core assertion: lastReadAt must be >= message.createdAt
    expect(bobMeta!.lastReadAt, 'Bob lastReadAt must not be null after mark-read').not.toBeNull();
    const lastReadAt = new Date(bobMeta!.lastReadAt!);
    expect(
      lastReadAt.getTime(),
      `Bob lastReadAt (${bobMeta!.lastReadAt}) must be >= message.createdAt (${message.createdAt})`,
    ).toBeGreaterThanOrEqual(messageCreatedAt.getTime());

    // unreadCount must be reset to 0
    expect(bobMeta!.unreadCount, 'Bob unreadCount must be 0 after mark-read').toBe(0);
  });

  test('Alice unreadCount stays 0 (she sent the message)', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    await request.post(`${BASE_URL}/api/conversations/${convo.id}/messages`, {
      data: { content: 'Hello from Alice' },
      headers: authHeaders(alice.tokens.accessToken),
    });

    const getRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${alice.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json() as {
      membersMeta: Array<{ userId: string; unreadCount: number }>;
    };

    const aliceMeta = body.membersMeta.find((m) => m.userId === alice.user.id);
    expect(aliceMeta, 'Alice must be in membersMeta').toBeDefined();
    expect(aliceMeta!.unreadCount, 'Alice unreadCount must be 0 (she sent the message)').toBe(0);
  });

  test('cross-account isolation: Bob cannot mark-read a conversation he is not a member of', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const carol = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(carol.user.id);
    verifyEmailInDb(bob.user.id);

    // Alice and Carol create a direct conversation (Bob is excluded)
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [carol.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    // Bob tries to mark-read Alice/Carol's conversation → 403
    const markReadRes = await request.post(
      `${BASE_URL}/api/conversations/${convo.id}/read`,
      { headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() } },
    );
    expect(markReadRes.status(), 'non-member mark-read must be 403').toBe(403);

    // Bob cannot GET Alice/Carol's conversation either
    const getRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(getRes.status(), 'non-member GET conversation must be 403 or 404').toBeGreaterThanOrEqual(403);
    expect(getRes.status()).toBeLessThanOrEqual(404);
  });

  test('multiple messages from Alice: Bob unreadCount reflects total, resets to 0 after mark-read', async ({ request }) => {
    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    // Alice sends 3 messages
    for (let i = 1; i <= 3; i++) {
      const res = await request.post(`${BASE_URL}/api/conversations/${convo.id}/messages`, {
        data: { content: `Message ${i} from Alice` },
        headers: authHeaders(alice.tokens.accessToken),
      });
      expect(res.status()).toBe(201);
    }

    // Bob checks conversation — unreadCount should be 3
    const beforeRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(beforeRes.status()).toBe(200);
    const beforeBody = await beforeRes.json() as {
      membersMeta: Array<{ userId: string; unreadCount: number }>;
    };
    const bobMetaBefore = beforeBody.membersMeta.find((m) => m.userId === bob.user.id);
    expect(bobMetaBefore!.unreadCount).toBe(3);

    // Bob marks read → unreadCount must go to 0
    await request.post(
      `${BASE_URL}/api/conversations/${convo.id}/read`,
      { headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() } },
    );

    const afterRes = await request.get(`${BASE_URL}/api/conversations/${convo.id}`, {
      headers: { Authorization: `Bearer ${bob.tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(afterRes.status()).toBe(200);
    const afterBody = await afterRes.json() as {
      membersMeta: Array<{ userId: string; unreadCount: number; lastReadAt: string | null }>;
    };
    const bobMetaAfter = afterBody.membersMeta.find((m) => m.userId === bob.user.id);
    expect(bobMetaAfter!.unreadCount).toBe(0);
    expect(bobMetaAfter!.lastReadAt).not.toBeNull();
  });
});

// ── Socket.io: message:read / typing events ───────────────────────────────────
//
// These tests use socket.io-client. To enable them:
//   1. Add to e2e/package.json devDependencies: "socket.io-client": "^4.8.3"
//   2. Run: pnpm --filter @nigerconnect/e2e install
//
// The socket tests verify:
//   - message:read event is broadcast to conversation room members with
//     {conversationId, userId, lastReadAt} after onRead handler fires
//   - typing:start / typing:stop events are forwarded to the room with
//     {conversationId, userId}
//   - message:new is broadcast when a message is sent via socket message:send

// Use a plain unknown type — avoids a static import of socket.io-client
// (which is not installed in e2e/node_modules). All socket operations go
// through the runtime-checked `socketConnect` helper below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let socketIoConnect: ((url: string, opts: Record<string, unknown>) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('socket.io-client') as Record<string, unknown>;
  // Handle both CJS default export and named io export
  const fn = (mod['io'] ?? mod['default']) as ((...args: unknown[]) => unknown) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof fn === 'function') socketIoConnect = fn as any;
} catch {
  // socket.io-client not installed — socket tests will be skipped
}

/**
 * Helper: create an authenticated socket connection to the /chat namespace.
 * Returns a connected socket. Throws if socket.io-client is not available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function connectChat(token: string): any {
  if (!socketIoConnect) throw new Error('socket.io-client not installed');
  return socketIoConnect(WS_URL + '/chat', {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

/**
 * Wait for a specific event on a socket, with a timeout (default 5 s).
 * Resolves with the event payload or rejects on timeout.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function waitForEvent(socket: any, event: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event "${event}" after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test.describe('Chat read receipts — Socket.io', () => {

  test.skip(
    !socketIoConnect,
    'socket.io-client not installed — add "socket.io-client": "^4.8.3" to e2e/package.json devDependencies and run pnpm install',
  );

  test('message:read event broadcast after socket onRead fires', async ({ request }) => {
    if (!socketIoConnect) test.skip(true, 'socket.io-client not installed');

    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    // Alice creates convo with Bob
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    // Alice sends a message via REST
    await request.post(`${BASE_URL}/api/conversations/${convo.id}/messages`, {
      data: { content: 'Socket read test message' },
      headers: authHeaders(alice.tokens.accessToken),
    });

    // Both connect to /chat
    const aliceSocket = connectChat(alice.tokens.accessToken);
    const bobSocket = connectChat(bob.tokens.accessToken);

    try {
      // Wait for both to connect
      await Promise.all([
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Alice socket connect timeout')), 5000);
          aliceSocket.on('connect', () => { clearTimeout(t); res(); });
          aliceSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Bob socket connect timeout')), 5000);
          bobSocket.on('connect', () => { clearTimeout(t); res(); });
          bobSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
      ]);

      // The server's handleConnection is async (it queries the DB to join conv rooms).
      // The client `connect` event fires when the transport is established, before
      // the server-side handleConnection has resolved. We wait a short fixed interval
      // so the server has finished joining both sockets to `conv:{id}` — without
      // which Alice's socket won't be in the room when Bob emits message:read.
      await new Promise<void>((r) => setTimeout(r, 500));

      // Alice waits for Bob's message:read event
      const readEventPromise = waitForEvent(aliceSocket, 'message:read', 8000);

      // Bob sends message:read via socket
      bobSocket.emit('message:read', { conversationId: convo.id });

      // Assert on the event Alice receives
      const readEvent = await readEventPromise as {
        conversationId: string;
        userId: string;
        lastReadAt: string;
      };

      expect(readEvent.conversationId).toBe(convo.id);
      expect(readEvent.userId).toBe(bob.user.id);
      expect(typeof readEvent.lastReadAt).toBe('string');
      // lastReadAt must be a valid ISO date
      expect(new Date(readEvent.lastReadAt).getTime()).toBeGreaterThan(0);

    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  /**
   * typing:start / typing:stop events
   *
   * What to assert (for reference when socket.io-client is installed):
   *   - Alice connects, Bob connects; Bob emits typing:start { conversationId }
   *   - Alice receives typing:start { conversationId, userId: bob.user.id }
   *   - Bob emits typing:stop { conversationId }
   *   - Alice receives typing:stop { conversationId, userId: bob.user.id }
   *   - typing events are NOT emitted back to the sender (Bob must NOT receive his own)
   */
  test('typing:start and typing:stop events forwarded to conversation peers', async ({ request }) => {
    if (!socketIoConnect) test.skip(true, 'socket.io-client not installed');

    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    // Create conversation
    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    const aliceSocket = connectChat(alice.tokens.accessToken);
    const bobSocket = connectChat(bob.tokens.accessToken);

    try {
      await Promise.all([
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Alice connect timeout')), 5000);
          aliceSocket.on('connect', () => { clearTimeout(t); res(); });
          aliceSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Bob connect timeout')), 5000);
          bobSocket.on('connect', () => { clearTimeout(t); res(); });
          bobSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
      ]);

      // The server's handleConnection is async (it queries the DB to join conv rooms).
      // The client `connect` event fires when the transport is established, before
      // the server-side handleConnection has resolved. We wait a short fixed interval
      // so the server has finished joining both sockets to `conv:{id}` — without
      // which the room-membership guard in onTypingStart silently drops the event.
      await new Promise<void>((r) => setTimeout(r, 500));

      // Alice waits for Bob's typing:start
      const typingStartPromise = waitForEvent(aliceSocket, 'typing:start', 8000);

      bobSocket.emit('typing:start', { conversationId: convo.id });

      const typingStartEvent = await typingStartPromise as {
        conversationId: string;
        userId: string;
      };
      expect(typingStartEvent.conversationId).toBe(convo.id);
      expect(typingStartEvent.userId).toBe(bob.user.id);

      // Alice waits for Bob's typing:stop
      const typingStopPromise = waitForEvent(aliceSocket, 'typing:stop', 8000);
      bobSocket.emit('typing:stop', { conversationId: convo.id });

      const typingStopEvent = await typingStopPromise as {
        conversationId: string;
        userId: string;
      };
      expect(typingStopEvent.conversationId).toBe(convo.id);
      expect(typingStopEvent.userId).toBe(bob.user.id);

    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  test('message:new event broadcast when Bob sends a message via socket message:send', async ({ request }) => {
    if (!socketIoConnect) test.skip(true, 'socket.io-client not installed');

    const alice = await register(request, randomEmail());
    const bob = await register(request, randomEmail());
    verifyEmailInDb(alice.user.id);
    verifyEmailInDb(bob.user.id);

    const createRes = await request.post(`${BASE_URL}/api/conversations`, {
      data: { participantIds: [bob.user.id] },
      headers: authHeaders(alice.tokens.accessToken),
    });
    expect(createRes.status()).toBe(201);
    const convo = await createRes.json() as { id: string };

    const aliceSocket = connectChat(alice.tokens.accessToken);
    const bobSocket = connectChat(bob.tokens.accessToken);

    try {
      await Promise.all([
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Alice connect timeout')), 5000);
          aliceSocket.on('connect', () => { clearTimeout(t); res(); });
          aliceSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
        new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('Bob connect timeout')), 5000);
          bobSocket.on('connect', () => { clearTimeout(t); res(); });
          bobSocket.on('connect_error', (e: Error) => { clearTimeout(t); rej(e); });
        }),
      ]);

      // The server's handleConnection is async (it queries the DB to join conv rooms).
      // The client `connect` event fires when the transport is established, before
      // the server-side handleConnection has resolved. We wait a short fixed interval
      // so the server has finished joining both sockets to `conv:{id}` — without
      // which Alice's socket won't be in the room to receive message:new from Bob.
      await new Promise<void>((r) => setTimeout(r, 500));

      // Alice listens for message:new
      const messageNewPromise = waitForEvent(aliceSocket, 'message:new', 10000);

      // Bob sends via socket
      bobSocket.emit('message:send', {
        conversationId: convo.id,
        content: 'Socket-sent message for message:new test',
      });

      const msgEvent = await messageNewPromise as {
        id: string;
        conversationId: string;
        content: string;
        senderId?: string;
        sender?: { id: string };
      };

      expect(msgEvent.conversationId ?? (msgEvent as unknown as Record<string, unknown>)['conversationId']).toBe(convo.id);
      expect(
        msgEvent.content,
        'message:new payload must include message content',
      ).toBe('Socket-sent message for message:new test');

    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });
});
