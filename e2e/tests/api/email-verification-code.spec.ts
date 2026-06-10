/**
 * POST /api/auth/verify-email/code — 6-digit email-verification CODE flow
 *
 * Prerequisites:
 *   API_BASE_URL=http://127.0.0.1:3000  (NestJS, prefix /api)
 *   Postgres accessible via docker exec nigerconnect-postgres (port 5433)
 *
 * Strategy:
 *   - Each test registers a fresh user with a unique X-Forwarded-For IP so
 *     the register throttle (3/min per IP) is never exhausted.
 *   - The 6-digit code is never returned by the API; the raw code is seeded by
 *     computing sha256('123456') and writing it into email_tokens via psql.
 *   - The verify-email/code route throttle is short:5/min per IP. Each
 *     test uses its own random IP so calls in the same minute never collide.
 *   - The LOCK test needs 6 wrong guesses. To avoid the 5/min throttle wall,
 *     each of the 6 guesses uses a distinct random IP — the JWT (user identity)
 *     is what scopes the token lookup, not the IP.
 */

import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';
const KNOWN_CODE = '123456';
const KNOWN_CODE_HASH = createHash('sha256').update(KNOWN_CODE).digest('hex');

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Run SQL via docker exec. SQL must be a single logical line (no embedded
 * newlines) because psql -c passes it as a shell argument. Collapse whitespace
 * before calling.
 */
function psql(sql: string): string {
  // Collapse all whitespace runs (including newlines) to a single space so the
  // SQL fits inside a single -c "..." shell argument on Windows/PowerShell.
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(
    `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect -c "${oneLine.replace(/"/g, '\\"')}"`,
    { stdio: 'pipe' },
  ).toString();
}

/**
 * Overwrite the code_hash of the newest unused verify_email token for userId
 * with sha256('123456'), and reset attempts + used_at so the row is fresh.
 */
function seedKnownCode(userId: string): void {
  psql(
    `UPDATE email_tokens
        SET code_hash = '${KNOWN_CODE_HASH}',
            attempts  = 0,
            used_at   = NULL
      WHERE id = (
            SELECT id FROM email_tokens
             WHERE user_id = '${userId}'::uuid
               AND type    = 'verify_email'
               AND used_at IS NULL
               AND code_hash IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 1
          );`,
  );
}

/**
 * Return the newest verify_email token row for the user (used or unused) as a
 * plain JSON object, or null when none exists.
 */
function getTokenRow(userId: string): {
  id: string;
  code_hash: string | null;
  attempts: number;
  used_at: string | null;
} | null {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT id, code_hash, attempts, used_at::text
         FROM email_tokens
        WHERE user_id = '${userId}'::uuid
          AND type    = 'verify_email'
       ORDER BY created_at DESC
        LIMIT 1
     ) t;`,
  );
  // psql outputs a line like:  {"id":"...","code_hash":"...","attempts":0,"used_at":null}
  const match = out.match(/\{.*\}/);
  return match ? (JSON.parse(match[0]) as ReturnType<typeof getTokenRow>) : null;
}

// ── Request helpers ───────────────────────────────────────────────────────────

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  return `10.${a}.${b}.${c}`;
}

function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2ecode+${ts}${rand}@nigerconnect.test`;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface AuthResponse {
  user: { id: string; email: string; emailVerified: boolean; [k: string]: unknown };
  tokens: TokenPair;
}

async function register(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'CodeTest', lastName: 'User' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

async function postCode(
  request: APIRequestContext,
  accessToken: string,
  code: string,
  ip = uniqueIp(),
) {
  return request.post(`${BASE_URL}/api/auth/verify-email/code`, {
    data: { code },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('POST /api/auth/verify-email/code', () => {

  // ── 1. Fresh user state ──────────────────────────────────────────────────

  test('1. fresh user: emailVerified=false and an unused verify_email token row with code_hash exists', async ({
    request,
  }) => {
    const { user } = await register(request, randomEmail());

    // emailVerified must be false from the register response
    expect(user.emailVerified, 'emailVerified should be false after register').toBe(false);

    // DB must have a token row created by register → sendVerificationEmail
    const row = getTokenRow(user.id);
    expect(row, 'email_tokens row must exist').not.toBeNull();
    expect(row!.code_hash, 'code_hash must not be null (createWithCode was called)').not.toBeNull();
    expect(row!.used_at, 'used_at must be null (token not yet consumed)').toBeNull();
  });

  // ── 2. SUCCESS path ──────────────────────────────────────────────────────

  test('2. success: seed sha256(123456), POST correct code → 200 {ok:true}, GET /me shows emailVerified=true, token used_at is set', async ({
    request,
  }) => {
    const email = randomEmail();
    const { user, tokens } = await register(request, email);

    seedKnownCode(user.id);

    const res = await postCode(request, tokens.accessToken, KNOWN_CODE);
    expect(
      res.status(),
      `verify-email/code correct code → expected 200, got ${res.status()}: ${await res.text()}`,
    ).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);

    // GET /api/auth/me must now show emailVerified=true
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as { user: Record<string, unknown> };
    expect(me.user['emailVerified'], '/me must reflect emailVerified=true after code success').toBe(true);

    // DB row must be consumed (used_at set)
    const row = getTokenRow(user.id);
    // The newest row is now the consumed one; used_at must not be null
    expect(row!.used_at, 'token used_at must be set after successful code verification').not.toBeNull();
  });

  // ── 3. WRONG code ────────────────────────────────────────────────────────

  test('3. wrong code: seed sha256(123456), POST 000000 → 400 with "invalide" message; user remains unverified', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, randomEmail());

    seedKnownCode(user.id);

    const res = await postCode(request, tokens.accessToken, '000000');
    expect(
      res.status(),
      `wrong code → expected 400, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    const message = String(body['message'] ?? '');
    expect(
      message.toLowerCase(),
      `error message should mention "invalide", got: ${message}`,
    ).toContain('invalide');

    // User must still be unverified
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = (await meRes.json()) as { user: Record<string, unknown> };
    expect(me.user['emailVerified'], 'user should remain unverified after wrong code').toBe(false);
  });

  // ── 4. VALIDATION errors ─────────────────────────────────────────────────

  test('4a. validation: code too short (2 digits) → 400 (Zod)', async ({ request }) => {
    // Register a separate user so this IP's calls don't pollute throttle
    const { tokens } = await register(request, randomEmail());

    const res = await postCode(request, tokens.accessToken, '12');
    expect(
      res.status(),
      `2-digit code → expected 400 (validation), got ${res.status()}`,
    ).toBe(400);
  });

  test('4b. validation: alphabetic code (6 letters) → 400 (Zod)', async ({ request }) => {
    const { tokens } = await register(request, randomEmail());

    const res = await postCode(request, tokens.accessToken, 'abcdef');
    expect(
      res.status(),
      `alpha code → expected 400 (validation), got ${res.status()}`,
    ).toBe(400);
  });

  // ── 5. LOCK after MAX_CODE_ATTEMPTS wrong guesses ────────────────────────

  test('5. lock: 6 wrong guesses exhaust attempts; message mentions "Trop" or "locked"; token used_at is set', async ({
    request,
  }) => {
    // Use a dedicated user + one unique IP per guess to stay under the
    // per-IP throttle of 5/min. The code-lock is enforced by the DB attempt
    // counter scoped to the user's token row — not by IP.
    const { user, tokens } = await register(request, randomEmail());

    seedKnownCode(user.id);

    let lastStatus = 0;
    let lastBody: Record<string, unknown> = {};

    for (let i = 0; i < 6; i++) {
      const ip = uniqueIp(); // fresh IP each guess → never hits short throttle
      const res = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
        data: { code: '000000' },
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
      });
      lastStatus = res.status();
      lastBody = (await res.json()) as Record<string, unknown>;

      // If we somehow hit throttle (shouldn't happen with unique IPs), fail fast
      if (lastStatus === 429) {
        throw new Error(
          `Throttle hit on guess ${i + 1} despite unique IP — test design assumption violated. Got 429.`,
        );
      }
    }

    // After 6 wrong guesses the row is burned — the last response should be 400
    expect(lastStatus, 'last guess (6th wrong) must return 400').toBe(400);
    const message = String(lastBody['message'] ?? '');
    // The service returns 'Trop de tentatives. Demande un nouveau code.' for 'locked'
    expect(
      message,
      `locked message should contain "Trop" or "tentatives", got: ${message}`,
    ).toMatch(/Trop|tentatives|lock/i);

    // DB row must now be consumed (used_at set) — burned by the 6th miss
    const row = getTokenRow(user.id);
    expect(row!.used_at, 'token used_at must be set after lock (row burned on 6th miss)').not.toBeNull();
  });
});
