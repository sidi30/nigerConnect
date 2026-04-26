// Quick Socket.io integration test
// Usage: node scripts/test-socket.js
const { io } = require('socket.io-client');

async function login(email, password) {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

(async () => {
  const l0 = await login('seed.user0@nigerconnect.local', 'Seed!Password99');
  const l1 = await login('seed.user1@nigerconnect.local', 'Seed!Password99');
  console.log(`u0 (${l0.user.displayName}) logged in`);
  console.log(`u1 (${l1.user.displayName}) logged in`);

  const s0 = io('http://localhost:3000/chat', {
    auth: { token: l0.tokens.accessToken },
    transports: ['websocket'],
  });
  const s1 = io('http://localhost:3000/chat', {
    auth: { token: l1.tokens.accessToken },
    transports: ['websocket'],
  });

  const connected = { s0: false, s1: false };
  s0.on('connect', () => { connected.s0 = true; console.log('[s0] connected'); });
  s1.on('connect', () => { connected.s1 = true; console.log('[s1] connected'); });
  s0.on('connect_error', (e) => console.log('[s0] connect_error', e.message));
  s1.on('connect_error', (e) => console.log('[s1] connect_error', e.message));

  s1.on('message:new', (msg) => {
    console.log(`[s1 RECEIVED] ${msg.sender.displayName}: ${msg.content}`);
  });
  s0.on('conversation:updated', (p) => {
    console.log(`[s0 notified conv updated] ${p.conversationId}`);
  });

  await new Promise((r) => setTimeout(r, 1000));
  if (!connected.s0 || !connected.s1) {
    console.log('⚠ Sockets failed to connect');
    process.exit(1);
  }

  // Find existing convo or create
  const convos = await fetch('http://localhost:3000/api/conversations', {
    headers: { Authorization: `Bearer ${l0.tokens.accessToken}` },
  }).then((r) => r.json());
  const convo = convos.items.find((c) => c.members.some((m) => m.id === l1.user.id));
  console.log(`Using conversation: ${convo.id}`);

  console.log('\n--- s0 emits message:send ---');
  s0.emit('message:send', { conversationId: convo.id, content: 'Test temps réel via socket 🚀' });

  await new Promise((r) => setTimeout(r, 1500));
  s0.disconnect();
  s1.disconnect();
  console.log('\n✓ Test terminé');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
