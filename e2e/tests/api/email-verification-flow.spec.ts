/**
 * Email-verification end-to-end flow (code-only, mobile path)
 *
 * Covers the complete happy-path and key sad-paths for the code-only
 * email-verification flow introduced after removing the "I clicked the link"
 * desktop path from mobile.
 *
 * Contract being tested:
 *   POST /api/auth/register          → creates user, seeds verify_email token with code_hash
 *   POST /api/auth/verify-email/send → resends code (returns 204, @AllowUnverified)
 *   POST /api/auth/verify-email/code → accepts 6-digit code, marks email verified
 *   GET  /api/auth/me                → reflects emailVerified=true after success
 *
 * This spec is the integration glue between the lower-level unit specs
 * (email-verification-code.spec.ts) and the guard spec
 * (email-verification-gate.spec.ts). It exercises the complete
 * register → code-verify → access-protected-route sequence.
 *
 * Prerequisites:
 *   API_BASE_URL=http://127.0.0.1:3000
 *   Postgres accessible via docker exec nigerconnect-postgres (port 5433)
 */

import { createHash } from 'crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eFlow#2026!z';
const KNOWN_CODE = '654321';
const KNOWN_CODE_HASH = createHash('sha256').update(KNOWN_CODE).digest('hex');

// ── DB helpers ────────────────────────────────────────────────────────────────

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
  return `e2eflow+${ts}${rand}@nigerconnect.test`;
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
    data: { email, password: VALID_PASSWORD, firstName: 'FlowTest', lastName: 'User' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(
    res.status(),
    `register ${email} → expected 201, got ${res.status()}: ${await res.text()}`,
  ).toBe(201);
  return (await res.json()) as AuthResponse;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Email-verification code-only flow (mobile contract)', () => {

  // ── 1. Happy path: full register → verify → access ────────────────────────

  test('1. full flow: register → seed code → POST code → /me shows verified → /feed accessible', async ({
    request,
  }) => {
    const email = randomEmail();
    const { user, tokens } = await register(request, email);

    // Guard must block /feed before verification
    const blocked = await request.get(`${BASE_URL}/api/feed`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(blocked.status(), '/feed must be 403 before email verification').toBe(403);
    const blockedBody = (await blocked.json()) as Record<string, unknown>;
    expect(blockedBody['code']).toBe('EMAIL_NOT_VERIFIED');

    // Seed known code into DB (simulates the app receiving the email code)
    seedKnownCode(user.id);

    // Submit the correct code via the mobile API endpoint
    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
      data: { code: KNOWN_CODE },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });
    expect(
      verifyRes.status(),
      `verify-email/code → expected 200, got ${verifyRes.status()}: ${await verifyRes.text()}`,
    ).toBe(200);
    const verifyBody = (await verifyRes.json()) as Record<string, unknown>;
    expect(verifyBody['ok']).toBe(true);

    // /me must now return emailVerified=true
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as { user: Record<string, unknown> };
    expect(me.user['emailVerified'], '/me must show emailVerified=true after code submit').toBe(true);

    // /feed must now be accessible
    const feedRes = await request.get(`${BASE_URL}/api/feed`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(feedRes.status(), '/feed must be 200 after email verification').toBe(200);
  });

  // ── 2. Resend endpoint works for unverified users ─────────────────────────

  test('2. POST /api/auth/verify-email/send is accessible for an unverified user and returns 204', async ({
    request,
  }) => {
    const { tokens } = await register(request, randomEmail());

    const res = await request.post(`${BASE_URL}/api/auth/verify-email/send`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Forwarded-For': uniqueIp(),
      },
    });
    expect(
      res.status(),
      `verify-email/send must return 204 for unverified user, got ${res.status()}`,
    ).toBe(204);
  });

  // ── 3. Already-verified user is idempotent ────────────────────────────────

  test('3. submitting the code a second time (replay) returns 400 (token already used)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, randomEmail());
    seedKnownCode(user.id);

    // First submission — must succeed
    const first = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
      data: { code: KNOWN_CODE },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });
    expect(first.status(), 'first code submission must succeed with 200').toBe(200);

    // Second submission with the same code — token is consumed, must fail
    const second = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
      data: { code: KNOWN_CODE },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });
    expect(
      second.status(),
      `replay of already-used code must return 400, got ${second.status()}`,
    ).toBe(400);
  });

  // ── 4. No token exists → 400 ─────────────────────────────────────────────

  test('4. POST /api/auth/verify-email/code without a Bearer token → 401', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
      data: { code: '123456' },
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(
      res.status(),
      `code endpoint without auth must return 401, got ${res.status()}`,
    ).toBe(401);
  });

  // ── 5. Verify-email/code route exists (mobile API contract) ───────────────

  test('5. POST /api/auth/verify-email/code exists and rejects a bad code with 400 (mobile API contract)', async ({
    request,
  }) => {
    const { user, tokens } = await register(request, randomEmail());
    seedKnownCode(user.id);

    const res = await request.post(`${BASE_URL}/api/auth/verify-email/code`, {
      data: { code: '000000' },
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
    });
    // Route exists (not 404) and rejects wrong code with 400
    expect(res.status(), 'wrong code must return 400, not 404 (route must exist)').toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    const message = String(body['message'] ?? '');
    expect(
      message.toLowerCase(),
      `error message should mention "invalide", got: ${message}`,
    ).toContain('invalide');
    // User must remain unverified
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = (await meRes.json()) as { user: Record<string, unknown> };
    expect(me.user['emailVerified'], 'user must remain unverified after bad code').toBe(false);
  });
});
