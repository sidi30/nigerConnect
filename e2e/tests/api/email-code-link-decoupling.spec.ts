/**
 * email-code-link-decoupling.spec.ts
 *
 * HEADLINE regression for fix #6 (the owner's bug): the verification email
 * carries TWO independent artefacts now — a web-fallback LINK and a 6-digit
 * CODE — stored in two SEPARATE email_tokens rows. Email security scanners
 * (Gmail/Outlook/Proofpoint) prefetch every link within seconds of delivery;
 * before the fix that prefetch consumed the single shared row and BURNED the
 * code the user still had to type, so a legitimate user typing the code got
 * "Aucun code en attente" / "Code invalide".
 *
 * This spec proves the decoupling end-to-end:
 *   1. register → two pending rows (link row: code_hash NULL; code row: code_hash set).
 *   2. Seed a KNOWN link token + a KNOWN code (same seed-a-hash technique as
 *      email-verification-code.spec.ts — the raw secrets are never returned by
 *      the API, so we write their sha256 into the rows ourselves).
 *   3. Scanner prefetch: GET /api/auth/verify-email?token=<link> consumes ONLY
 *      the link row.
 *   4. The user then types the code: POST /api/auth/verify-email/code MUST still
 *      succeed (200 ok:true) — the code row was untouched by the prefetch.
 *
 * Plus: resend issues a fresh working code, and the 15-minute TTL is asserted
 * indirectly from expires_at - created_at (we cannot wait 15 min in CI).
 *
 * Open mode only — parallel-safe. Each call uses a unique X-Forwarded-For.
 *
 * Prerequisites: NestJS on :3000, Postgres reachable.
 */

import { createHash } from 'crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eLink#2026!z';
const KNOWN_CODE = '246813';
const KNOWN_CODE_HASH = createHash('sha256').update(KNOWN_CODE).digest('hex');
const KNOWN_LINK_TOKEN = 'e2e-known-link-token-' ;

// ── DB helpers ──────────────────────────────────────────────────────────────

/** Seed sha256(KNOWN_CODE) into the user's newest pending CODE row. */
function seedKnownCode(userId: string): void {
  psql(
    `UPDATE email_tokens
        SET code_hash = '${KNOWN_CODE_HASH}', attempts = 0, used_at = NULL
      WHERE id = (
            SELECT id FROM email_tokens
             WHERE user_id = '${userId}'::uuid AND type = 'verify_email'
               AND used_at IS NULL AND code_hash IS NOT NULL
             ORDER BY created_at DESC LIMIT 1);`,
  );
}

/**
 * Seed a KNOWN raw link token into the user's newest pending LINK row (the row
 * with code_hash NULL). Returns the raw token to hand to the verify-email GET.
 * Per-user unique suffix keeps the token_hash UNIQUE constraint happy.
 */
function seedKnownLinkToken(userId: string): string {
  const raw = KNOWN_LINK_TOKEN + userId;
  const hash = createHash('sha256').update(raw).digest('hex');
  psql(
    `UPDATE email_tokens
        SET token_hash = '${hash}', used_at = NULL
      WHERE id = (
            SELECT id FROM email_tokens
             WHERE user_id = '${userId}'::uuid AND type = 'verify_email'
               AND used_at IS NULL AND code_hash IS NULL
             ORDER BY created_at DESC LIMIT 1);`,
  );
  return raw;
}

/** Is the newest pending CODE row still unused (used_at IS NULL)? */
function codeRowStillPending(userId: string): boolean {
  const out = psql(
    `SELECT count(*)::int AS n FROM email_tokens
      WHERE user_id = '${userId}'::uuid AND type = 'verify_email'
        AND code_hash IS NOT NULL AND used_at IS NULL;`,
  );
  const m = out.match(/\d+/);
  return m ? parseInt(m[0], 10) > 0 : false;
}

/** TTL (seconds) of the newest CODE row = expires_at - created_at. */
function codeRowTtlSeconds(userId: string): number {
  const out = psql(
    `SELECT row_to_json(t) FROM (
       SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl
         FROM email_tokens
        WHERE user_id = '${userId}'::uuid AND type = 'verify_email'
          AND code_hash IS NOT NULL
        ORDER BY created_at DESC LIMIT 1) t;`,
  );
  const m = out.match(/\{.*\}/);
  return m ? (JSON.parse(m[0]) as { ttl: number }).ttl : -1;
}

// ── Request helpers ───────────────────────────────────────────────────────────

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2elink+${ts}${rand}@nigerconnect.test`;
}

interface AuthResponse {
  user: { id: string; email: string; emailVerified: boolean; [k: string]: unknown };
  tokens: { accessToken: string; refreshToken: string };
}

async function register(request: APIRequestContext, email: string): Promise<AuthResponse> {
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'LinkTest', lastName: 'User' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `register → 201: ${await res.text()}`).toBe(201);
  return (await res.json()) as AuthResponse;
}

async function postCode(request: APIRequestContext, accessToken: string, code: string) {
  return request.post(`${BASE_URL}/api/auth/verify-email/code`, {
    data: { code },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': uniqueIp(),
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════

test.describe('Email CODE survives a LINK prefetch (fix #6)', () => {
  test('HEADLINE: scanner GET of the link does NOT burn the typed code — code still verifies (200)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, randomEmail());

    const linkToken = seedKnownLinkToken(user.id);
    seedKnownCode(user.id);

    // ── Simulate the email scanner prefetching the web-fallback link ──
    const prefetch = await request.get(
      `${BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(linkToken)}`,
      { headers: { Accept: 'application/json', 'X-Forwarded-For': uniqueIp() } },
    );
    expect(prefetch.status(), 'link prefetch → 200').toBe(200);
    const prefetchBody = (await prefetch.json()) as { ok: boolean };
    expect(prefetchBody.ok, 'link row consumed by the prefetch').toBe(true);

    // The CODE row must be untouched by the link prefetch.
    expect(
      codeRowStillPending(user.id),
      'code row must remain pending after the link prefetch (decoupled rows)',
    ).toBe(true);

    // ── The user now types the 6-digit code — MUST still succeed ──
    const codeRes = await postCode(request, tokens.accessToken, KNOWN_CODE);
    expect(
      codeRes.status(),
      `typed code after link prefetch MUST still verify (200), got ${codeRes.status()}: ${await codeRes.text()}`,
    ).toBe(200);
    expect((await codeRes.json())['ok']).toBe(true);

    // /me reflects a verified account.
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = (await meRes.json()) as { user: { emailVerified: boolean } };
    expect(me.user.emailVerified, '/me → emailVerified true').toBe(true);
  });

  test('resend (POST /verify-email/send) issues a fresh code that verifies', async ({ request }) => {
    const { user, tokens } = await register(request, randomEmail());

    const sendRes = await request.post(`${BASE_URL}/api/auth/verify-email/send`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Forwarded-For': uniqueIp() },
    });
    expect(sendRes.status(), 'resend → 204').toBe(204);

    // Seed the freshly-minted code row and verify with it.
    seedKnownCode(user.id);
    const codeRes = await postCode(request, tokens.accessToken, KNOWN_CODE);
    expect(codeRes.status(), 'fresh resent code verifies → 200').toBe(200);
    expect((await codeRes.json())['ok']).toBe(true);
  });

  test('15-minute TTL: the code row expires_at is ~15 min after created_at', async ({ request }) => {
    const { user } = await register(request, randomEmail());
    const ttl = codeRowTtlSeconds(user.id);
    // 15 min = 900 s. Allow a small skew window (840–960 s) — asserts the TTL
    // policy without waiting 15 minutes for real expiry.
    expect(ttl, `code TTL should be ~900s (15 min), got ${ttl}s`).toBeGreaterThanOrEqual(840);
    expect(ttl, `code TTL should be ~900s (15 min), got ${ttl}s`).toBeLessThanOrEqual(960);
  });
});
