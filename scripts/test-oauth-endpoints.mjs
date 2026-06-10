#!/usr/bin/env node
/**
 * NigerConnect — OAuth endpoints smoke test
 *
 * Vérifie que les routes POST /api/auth/google et POST /api/auth/apple
 * existent, rejettent correctement les tokens invalides avec 401, et que
 * la validation Zod retourne 400 sur un body vide.
 *
 * Ce script ne démarre PAS l'API. Il frappe une instance déjà en cours.
 *
 * Usage :
 *   node scripts/test-oauth-endpoints.mjs
 *   API_URL=http://localhost:3000 node scripts/test-oauth-endpoints.mjs
 *
 * Prérequis :
 *   - L'API NigerConnect doit tourner à API_URL (défaut: http://localhost:3000)
 *   - Au moins une variable GOOGLE_CLIENT_ID* ou APPLE_CLIENT_ID doit être
 *     configurée côté API pour que le service soit "configured". Si aucune
 *     clé n'est présente, les 401 comportent un message différent
 *     ("not configured") — le script l'accepte comme rejet valide.
 *
 * Idempotent : aucune donnée n'est écrite en base (les tokens sont rejetés
 * avant toute interaction avec Prisma).
 */

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// ── Helpers ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;

/**
 * Run a single test case.
 *
 * @param {string} label   - Human-readable test name
 * @param {() => Promise<void>} fn - Async function that throws on failure
 */
async function test(label, fn) {
  try {
    await fn();
    console.log(`${GREEN}PASS${RESET} ${label}`);
    passed++;
  } catch (err) {
    console.log(`${RED}FAIL${RESET} ${label}`);
    console.log(`     ${DIM}${err.message}${RESET}`);
    failed++;
  }
}

/**
 * POST to an API endpoint and return { status, body }.
 *
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<{ status: number; body: unknown }>}
 */
async function post(path, body) {
  const url = `${API_URL}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Network error reaching ${url} — is the API running?\n     ${err.message}\n` +
      `     Start it with:  cd apps/api && npm run dev`,
    );
  }
  let responseBody;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return { status: response.status, body: responseBody };
}

function assertStatus(actual, expected, context) {
  if (actual !== expected) {
    throw new Error(
      `Expected HTTP ${expected}, got HTTP ${actual}. Body: ${JSON.stringify(context)}`,
    );
  }
}

// ── Check API reachability ─────────────────────────────────────────────────────

async function checkReachable() {
  try {
    const r = await fetch(`${API_URL}/health`);
    if (!r.ok && r.status !== 404) {
      // 404 is fine — /health may not exist but means the server is up
    }
  } catch (err) {
    console.error(
      `${RED}${BOLD}ERROR${RESET} Cannot reach ${API_URL}`,
    );
    console.error(
      `${DIM}Make sure the API is running:${RESET}\n  cd apps/api && npm run dev`,
    );
    process.exit(1);
  }
}

// ── Test cases ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log(`\n${BOLD}NigerConnect — OAuth endpoint smoke tests${RESET}`);
  console.log(`${DIM}Target: ${API_URL}${RESET}\n`);

  await checkReachable();

  // ── Google ──────────────────────────────────────────────────────────────────

  await test('POST /api/auth/google — invalid idToken → 401', async () => {
    const { status, body } = await post('/api/auth/google', {
      idToken: 'this.is.not.a.valid.google.id.token',
    });
    // Accept 401 with any message (may say "not configured" if no GOOGLE_CLIENT_ID is set,
    // or "Invalid Google ID token" if configured but the token fails verification).
    assertStatus(status, 401, body);
  });

  await test('POST /api/auth/google — token with wrong structure → 401', async () => {
    // A structurally plausible but fake JWT (3 parts, base64-encoded garbage payload)
    const fakeJwt =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiYXVkIjoiZmFrZS1jbGllbnQtaWQiLCJpYXQiOjE2MDAwMDAwMDB9' +
      '.INVALIDSIGNATURE';
    const { status, body } = await post('/api/auth/google', { idToken: fakeJwt });
    assertStatus(status, 401, body);
  });

  await test('POST /api/auth/google — missing body → 400 (Zod validation)', async () => {
    const { status, body } = await post('/api/auth/google', {});
    assertStatus(status, 400, body);
  });

  await test('POST /api/auth/google — empty idToken string → 400 (Zod min(1))', async () => {
    const { status, body } = await post('/api/auth/google', { idToken: '' });
    assertStatus(status, 400, body);
  });

  await test('POST /api/auth/google — idToken is a number → 400 (Zod type)', async () => {
    const { status, body } = await post('/api/auth/google', { idToken: 42 });
    assertStatus(status, 400, body);
  });

  // ── Apple ───────────────────────────────────────────────────────────────────

  await test('POST /api/auth/apple — invalid identityToken → 401', async () => {
    const { status, body } = await post('/api/auth/apple', {
      identityToken: 'this.is.not.a.valid.apple.identity.token',
    });
    // As with Google: accept 401 regardless of the message.
    assertStatus(status, 401, body);
  });

  await test('POST /api/auth/apple — token with wrong structure → 401', async () => {
    const fakeJwt =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIwMDAyMzYuYWJjZGVmZ2gudXMiLCJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoiY29tLm5pZ2VyY29ubmVjdC5hcHAifQ' +
      '.INVALIDSIGNATURE';
    const { status, body } = await post('/api/auth/apple', { identityToken: fakeJwt });
    assertStatus(status, 401, body);
  });

  await test('POST /api/auth/apple — missing body → 400 (Zod validation)', async () => {
    const { status, body } = await post('/api/auth/apple', {});
    assertStatus(status, 400, body);
  });

  await test('POST /api/auth/apple — empty identityToken → 400 (Zod min(1))', async () => {
    const { status, body } = await post('/api/auth/apple', { identityToken: '' });
    assertStatus(status, 400, body);
  });

  await test('POST /api/auth/apple — optional fields ignored when token is invalid → 401', async () => {
    // Ensure extra fields (fullName, email) do not bypass token verification.
    const { status, body } = await post('/api/auth/apple', {
      identityToken: 'garbage.token.here',
      fullName: { givenName: 'Moussa', familyName: 'Issa' },
      email: 'moussa@example.com',
    });
    assertStatus(status, 401, body);
  });

  // ── Route existence sanity checks ────────────────────────────────────────────

  await test('POST /api/auth/google route exists (not 404)', async () => {
    const { status } = await post('/api/auth/google', { idToken: 'x' });
    if (status === 404) {
      throw new Error(`Route not found (404). Is the API_PREFIX set to "api"?`);
    }
    // Any non-404 response (400, 401, etc.) confirms the route is registered.
  });

  await test('POST /api/auth/apple route exists (not 404)', async () => {
    const { status } = await post('/api/auth/apple', { identityToken: 'x' });
    if (status === 404) {
      throw new Error(`Route not found (404). Is the API_PREFIX set to "api"?`);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log('');
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${passed} tests passed.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}${failed} test(s) failed${RESET}, ${passed} passed.`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(`${RED}Unexpected error:${RESET}`, err);
  process.exit(1);
});
