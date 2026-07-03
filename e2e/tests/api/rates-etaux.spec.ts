/**
 * rates-etaux.spec.ts — E-TAUX QA (spec memory/spec-etaux.md).
 *
 * Full HTTP contract coverage — this feature has NO media, so everything is
 * cleanly e2e-testable end-to-end:
 *
 *   F1 taux du jour
 *     AC-F1-01/03 GET /rates/today public → eurXof = 655.957 constant peg;
 *                 USD/CAD derived or null; source ∈ {ecb, unavailable}, never a
 *                 fabricated value.
 *     AC-F1-04    GET /rates/banner public → { rates, prices }.
 *   F2 signaler un prix
 *     AC-F2-01    create valid → 201, status active, trustScore 0,
 *                 submitter = the caller (submitterId NEVER from the body).
 *     AC-F2-02    Zod strict (amount<=0, bad currency) → 400.
 *     AC-F2-03    throttle: 6th create in a day → 429.
 *     AC-F2-04    owner-only PATCH (non-owner → 403).
 *     AC-F2-05    owner-only DELETE (non-owner → 403), unknown id → 404.
 *   F3 voter
 *     AC-F3-01    first vote → trustScore +1, myVote echoed.
 *     AC-F3-02    revote-same = retract → trustScore back to 0.
 *     AC-F3-03    flip vote → delta -2.
 *     AC-F3-04    anti-auto-vote (author votes own) → 403.
 *     err         vote unknown id → 404.
 *   F4 liste       GET /community-prices?type=… paginated, active-only default.
 *   F5 report      POST /reports { targetType:'community_price' } → 201.
 *
 * Note on the FX source: `source` may legitimately be 'ecb' (a snapshot exists)
 * or 'unavailable' (fresh DB, cron not yet run). The suite asserts the invariant
 * (peg constant, no fabricated USD/CAD when unavailable) regardless of which.
 *
 * Prerequisites: API on http://127.0.0.1:3000, Postgres (psql), Redis.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { psql } from './_db-exec';

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const VALID_PASSWORD = 'E2eTest#2026!z';
const EUR_XOF_PEG = 655.957;

// ── helpers ──────────────────────────────────────────────────────────────────

function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}
function randomEmail(prefix = 'e2erates'): string {
  return `${prefix}+${Date.now()}${Math.random().toString(36).slice(2, 7)}@nigerconnect.test`;
}
function verifyEmailInDb(userId: string): void {
  psql(`UPDATE users SET email_verified = true WHERE id = '${userId}';`);
}

interface AuthResponse {
  user: { id: string; email: string; [k: string]: unknown };
  tokens: { accessToken: string; refreshToken: string };
}

async function registerVerified(request: APIRequestContext): Promise<AuthResponse> {
  const email = randomEmail();
  const res = await request.post(`${BASE_URL}/api/auth/register`, {
    data: { email, password: VALID_PASSWORD, firstName: 'RateE2E', lastName: 'Test' },
    headers: { 'X-Forwarded-For': uniqueIp(), 'Content-Type': 'application/json' },
  });
  expect(res.status(), `register: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as AuthResponse;
  verifyEmailInDb(body.user.id);
  return body;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': uniqueIp(),
  };
}

function validPrice(overrides: Record<string, unknown> = {}) {
  return {
    type: 'transfert_argent',
    originCountry: 'FR',
    destCountry: 'NE',
    provider: 'Wave',
    amount: 5,
    currency: 'EUR',
    note: 'frais sur 200€ envoyés',
    ...overrides,
  };
}

async function createPrice(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request.post(`${BASE_URL}/api/community-prices`, {
    data: validPrice(overrides),
    headers: authHeaders(token),
  });
  return res;
}

// ── F1 — taux du jour ────────────────────────────────────────────────────────

test.describe('E-TAUX F1 — GET /rates/today (public)', () => {
  test('AC-F1 — public, peg EUR/XOF constant, USD/CAD derived-or-null, source honest', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/rates/today`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      eurXof: number;
      usdXof: number | null;
      cadXof: number | null;
      asOf: string | null;
      source: 'ecb' | 'unavailable';
    };
    // The peg is a regulatory constant — NEVER fetched, NEVER absent.
    expect(body.eurXof).toBe(EUR_XOF_PEG);
    expect(['ecb', 'unavailable']).toContain(body.source);
    if (body.source === 'unavailable') {
      // AC-F1-03: no fabricated cross rates when there is no snapshot.
      expect(body.usdXof).toBeNull();
      expect(body.cadXof).toBeNull();
      expect(body.asOf).toBeNull();
    } else {
      // AC-F1-01: derived, positive, plausible (XOF per USD ~500-800).
      expect(body.usdXof === null || body.usdXof > 0).toBe(true);
      expect(typeof body.asOf).toBe('string');
    }
  });

  test('AC-F1-04 — GET /rates/banner (auth) returns { rates, prices }', async ({ request }) => {
    // BUG-001: the banner embeds community prices with a contributor projection,
    // so it is auth-gated (anonymous → 401), aligned with marketplace /services.
    const anon = await request.get(`${BASE_URL}/api/rates/banner`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(anon.status(), 'banner must not be reachable anonymously').toBe(401);

    const { tokens } = await registerVerified(request);
    const res = await request.get(`${BASE_URL}/api/rates/banner`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { rates: { eurXof: number }; prices: unknown[] };
    expect(body.rates.eurXof).toBe(EUR_XOF_PEG);
    expect(Array.isArray(body.prices)).toBe(true);
  });
});

// ── F2 — signaler un prix ─────────────────────────────────────────────────────

test.describe('E-TAUX F2 — POST /community-prices', () => {
  test('AC-F2-01 — create valid → 201, active, trustScore 0, submitter = caller', async ({
    request,
  }) => {
    const { user, tokens } = await registerVerified(request);
    const res = await createPrice(request, tokens.accessToken);
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as {
      id: string;
      status: string;
      trustScore: number;
      submitterId: string;
      submitter: { id: string };
    };
    expect(body.status).toBe('active');
    expect(body.trustScore).toBe(0);
    expect(body.submitter.id).toBe(user.id);
  });

  test('AC — submitterId in the body is IGNORED (anti-IDOR)', async ({ request }) => {
    const { user, tokens } = await registerVerified(request);
    const victim = await registerVerified(request);
    const res = await createPrice(request, tokens.accessToken, { submitterId: victim.user.id });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { submitter: { id: string } };
    // The report belongs to the caller, never the injected victim id.
    expect(body.submitter.id).toBe(user.id);
    expect(body.submitter.id).not.toBe(victim.user.id);
  });

  test('AC-F2-02 — Zod rejects amount<=0 → 400', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const res = await createPrice(request, tokens.accessToken, { amount: 0 });
    expect(res.status()).toBe(400);
  });

  test('AC-F2-02 — Zod rejects a non-ISO currency → 400', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const res = await createPrice(request, tokens.accessToken, { currency: 'EURO' });
    expect(res.status()).toBe(400);
  });

  test('create requires authentication (401)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/community-prices`, {
      data: validPrice(),
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status()).toBe(401);
  });

  test('AC-F2-03 — per-user daily throttle: the 6th report of the day → 429', async ({
    request,
  }) => {
    const { tokens } = await registerVerified(request);
    // 5 allowed, the 6th trips the Redis daily cap (MAX_SUBMISSIONS_PER_DAY = 5).
    for (let i = 0; i < 5; i++) {
      const ok = await createPrice(request, tokens.accessToken, { note: `n${i}` });
      expect(ok.status(), `submission ${i + 1} should pass`).toBe(201);
    }
    const sixth = await createPrice(request, tokens.accessToken, { note: 'over' });
    expect(sixth.status(), await sixth.text()).toBe(429);
  });
});

// ── F2 — owner-only update/delete (AuthZ, anti-IDOR) ─────────────────────────

test.describe('E-TAUX F2 — owner-only mutations', () => {
  test('AC-F2-04 — owner can PATCH; a stranger gets 403', async ({ request }) => {
    const owner = await registerVerified(request);
    const stranger = await registerVerified(request);
    const created = await createPrice(request, owner.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };

    const byOwner = await request.patch(`${BASE_URL}/api/community-prices/${id}`, {
      data: { amount: 9 },
      headers: authHeaders(owner.tokens.accessToken),
    });
    expect(byOwner.status(), await byOwner.text()).toBe(200);

    const byStranger = await request.patch(`${BASE_URL}/api/community-prices/${id}`, {
      data: { amount: 1 },
      headers: authHeaders(stranger.tokens.accessToken),
    });
    expect(byStranger.status()).toBe(403);
  });

  test('AC-F2-05 — owner can DELETE; a stranger gets 403; unknown id → 404', async ({
    request,
  }) => {
    const owner = await registerVerified(request);
    const stranger = await registerVerified(request);
    const created = await createPrice(request, owner.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };

    const byStranger = await request.delete(`${BASE_URL}/api/community-prices/${id}`, {
      headers: authHeaders(stranger.tokens.accessToken),
    });
    expect(byStranger.status()).toBe(403);

    const unknown = await request.delete(
      `${BASE_URL}/api/community-prices/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders(owner.tokens.accessToken) },
    );
    expect(unknown.status()).toBe(404);

    const byOwner = await request.delete(`${BASE_URL}/api/community-prices/${id}`, {
      headers: authHeaders(owner.tokens.accessToken),
    });
    expect(byOwner.status()).toBe(204);
  });
});

// ── F3 — votes ────────────────────────────────────────────────────────────────

test.describe('E-TAUX F3 — trust votes', () => {
  test('AC-F3-01/02 — first vote +1 then revote-same retracts to 0', async ({ request }) => {
    const author = await registerVerified(request);
    const voter = await registerVerified(request);
    const created = await createPrice(request, author.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };

    const up = await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: 1 },
      headers: authHeaders(voter.tokens.accessToken),
    });
    expect(up.status(), await up.text()).toBeLessThan(300);
    const upBody = (await up.json()) as { trustScore: number; myVote: number | null };
    expect(upBody.trustScore).toBe(1);
    expect(upBody.myVote).toBe(1);

    // Toggle-idempotent: re-voting the same value retracts it.
    const retract = await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: 1 },
      headers: authHeaders(voter.tokens.accessToken),
    });
    const retractBody = (await retract.json()) as { trustScore: number; myVote: number | null };
    expect(retractBody.trustScore).toBe(0);
    expect(retractBody.myVote).toBeNull();
  });

  test('AC-F3-03 — flipping +1 → -1 applies a delta of -2', async ({ request }) => {
    const author = await registerVerified(request);
    const voter = await registerVerified(request);
    const created = await createPrice(request, author.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };

    await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: 1 },
      headers: authHeaders(voter.tokens.accessToken),
    });
    const flip = await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: -1 },
      headers: authHeaders(voter.tokens.accessToken),
    });
    const body = (await flip.json()) as { trustScore: number; myVote: number | null };
    expect(body.trustScore).toBe(-1); // +1 removed, -1 applied
    expect(body.myVote).toBe(-1);
  });

  test('AC-F3-04 — anti-auto-vote: the author cannot vote on their own report (403)', async ({
    request,
  }) => {
    const author = await registerVerified(request);
    const created = await createPrice(request, author.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };
    const res = await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: 1 },
      headers: authHeaders(author.tokens.accessToken),
    });
    expect(res.status()).toBe(403);
  });

  test('vote on an unknown id → 404', async ({ request }) => {
    const { tokens } = await registerVerified(request);
    const res = await request.post(
      `${BASE_URL}/api/community-prices/00000000-0000-4000-8000-000000000000/vote`,
      { data: { value: 1 }, headers: authHeaders(tokens.accessToken) },
    );
    expect(res.status()).toBe(404);
  });

  test('vote value must be exactly 1 or -1 (Zod → 400)', async ({ request }) => {
    const author = await registerVerified(request);
    const voter = await registerVerified(request);
    const created = await createPrice(request, author.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };
    const res = await request.post(`${BASE_URL}/api/community-prices/${id}/vote`, {
      data: { value: 2 },
      headers: authHeaders(voter.tokens.accessToken),
    });
    expect(res.status()).toBe(400);
  });
});

// ── F4 — liste ────────────────────────────────────────────────────────────────

test.describe('E-TAUX F4 — GET /community-prices (auth, paginated)', () => {
  test('AC-F4-01 — list is filterable by type and returns { items, nextCursor }', async ({
    request,
  }) => {
    const { tokens } = await registerVerified(request);
    await createPrice(request, tokens.accessToken, { type: 'colis_kg', destCountry: 'NE' });

    const res = await request.get(`${BASE_URL}/api/community-prices?type=colis_kg&limit=20`, {
      headers: authHeaders(tokens.accessToken),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { items: Array<{ type: string; status: string }>; nextCursor: string | null };
    expect(Array.isArray(body.items)).toBe(true);
    // Every returned row matches the filter and is active by default.
    for (const it of body.items) {
      expect(it.type).toBe('colis_kg');
      expect(it.status).toBe('active');
    }
    expect(body.nextCursor === null || typeof body.nextCursor === 'string').toBe(true);
  });
});

// ── PRIVACY regression guard (BUG-001) ───────────────────────────────────────
//
// Double barrier (defense-in-depth), aligned with marketplace /services:
//   1. The list/detail/banner are AUTH-GATED — an anonymous caller gets 401 and
//      never receives any submitter projection at all.
//   2. Even for an authenticated caller, the submitter projection is PII-free:
//      no firstName/lastName/city/countryCode (no real name, no coarse geoloc),
//      only { id, displayName, avatarUrl, isAmbassador }.
//
// Was RED before the BUG-001 fix (routes were @Public + full PII projection).

test.describe('E-TAUX — privacy: listing must not leak contributor PII', () => {
  test('BUG-001a — anonymous listing is rejected (401), never a scraping surface', async ({
    request,
  }) => {
    const { tokens } = await registerVerified(request);
    await createPrice(request, tokens.accessToken, { type: 'billet_avion' });

    // NO Authorization header — a pure anonymous scrape must be refused outright.
    const res = await request.get(`${BASE_URL}/api/community-prices?type=billet_avion&limit=20`, {
      headers: { 'X-Forwarded-For': uniqueIp() },
    });
    expect(res.status(), 'anonymous list must be auth-gated').toBe(401);
  });

  test('BUG-001b — authenticated listing exposes a PII-free submitter projection', async ({
    request,
  }) => {
    const author = await registerVerified(request);
    await createPrice(request, author.tokens.accessToken, { type: 'billet_avion' });
    const reader = await registerVerified(request);

    const res = await request.get(`${BASE_URL}/api/community-prices?type=billet_avion&limit=20`, {
      headers: authHeaders(reader.tokens.accessToken),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ submitter?: Record<string, unknown> }>;
    };
    for (const it of body.items) {
      const s = it.submitter ?? {};
      // Never a contributor's real name or coarse location, even between members.
      expect(s['lastName'], 'lastName must not be exposed').toBeUndefined();
      expect(s['firstName'], 'firstName must not be exposed').toBeUndefined();
      expect(s['city'], 'city must not be exposed').toBeUndefined();
      expect(s['countryCode'], 'countryCode must not be exposed').toBeUndefined();
      expect(s['identityStatus'], 'identityStatus must not be exposed').toBeUndefined();
    }
  });
});

// ── F5 — report an abusive price (reuses the moderation module) ───────────────

test.describe('E-TAUX F5 — POST /reports on a community_price', () => {
  test('AC-F5-01 — a member can report a community_price → 201', async ({ request }) => {
    const author = await registerVerified(request);
    const reporter = await registerVerified(request);
    const created = await createPrice(request, author.tokens.accessToken);
    const { id } = (await created.json()) as { id: string };

    const res = await request.post(`${BASE_URL}/api/reports`, {
      data: { targetType: 'community_price', targetId: id, reason: 'scam' },
      headers: authHeaders(reporter.tokens.accessToken),
    });
    expect(res.status(), await res.text()).toBe(201);
  });
});
