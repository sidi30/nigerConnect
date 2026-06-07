import { defineConfig, devices } from '@playwright/test';

/**
 * NigerConnect Playwright configuration.
 *
 * Three test projects:
 *   1. api-oauth-contract    — POST /api/auth/google + apple. Request fixture only, no browser.
 *   2. api-session-lifecycle — register/login/me/refresh/logout pipeline. Request only.
 *   3. web-auth-pages        — /reset-password and /verify-email. Headless Chromium.
 *
 * Prerequisites (servers must be running before `playwright test`):
 *   1. Postgres on 5433, Redis on 6379:
 *        docker compose up -d postgres redis
 *   2. Prisma migrations applied (includes the P0 oauth_provider_unique migration):
 *        cd apps/api && npx prisma migrate deploy
 *   3. NestJS API on port 3000:
 *        cd apps/api && npm run dev   (or: node dist/main after `npm run build`)
 *   4. Next.js web on port 3001 (standalone build recommended):
 *        cd apps/web && npm run build
 *        PORT=3001 node apps/web/.next/standalone/apps/web/server.js
 *      (copy .next/static and public/ into the standalone dir first — see CI runbook)
 *
 * CI runbook (GitHub Actions / similar):
 *   - services: postgres:16, redis:7 (healthcheck until pg_isready / redis-cli ping)
 *   - run: cd apps/api && npx prisma migrate deploy && npm run build
 *   - run: node apps/api/dist/main &
 *   - run: cd apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/static && cp -r public .next/standalone/apps/web/public
 *   - run: PORT=3001 node apps/web/.next/standalone/apps/web/server.js &
 *   - run: npx wait-on http://localhost:3000/health/live http://localhost:3001
 *   - run: cd e2e && npm ci && npx playwright install --with-deps chromium && npm run test:e2e:playwright
 *
 * Env overrides:
 *   API_BASE_URL   default http://localhost:3000   (global prefix /api applied per-request)
 *   WEB_BASE_URL   default http://localhost:3001
 *
 * Note on the Next.js web server and CSP:
 *   The served Content-Security-Policy includes `upgrade-insecure-requests`, which
 *   makes Chromium try to upgrade http→https for sub-resources in some situations.
 *   The web tests use waitUntil:'commit' to avoid blocking on external font/script
 *   loads, which cannot complete in a network-isolated CI environment.
 *
 * Note on API rate limiting:
 *   The register endpoint has a per-IP throttle of 3 req/min. Session lifecycle
 *   tests each send a unique X-Forwarded-For IP to avoid exhausting this limit
 *   when tests run in parallel. This is intentional dev/test practice.
 */

const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const WEB_BASE_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ── API-only tests (no browser, just Playwright's request fixture) ──────
    {
      name: 'api-oauth-contract',
      testMatch: 'api/oauth-contract.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-session-lifecycle',
      testMatch: 'api/session-lifecycle.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-mobile-fixes',
      testMatch: 'api/mobile-fixes-contract.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-email-verification-gate',
      testMatch: 'api/email-verification-gate.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-email-verification-code',
      testMatch: 'api/email-verification-code.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-email-verification-flow',
      testMatch: 'api/email-verification-flow.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-features',
      testMatch: 'api/features-contract.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-geo-cities',
      testMatch: 'api/geo-cities.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-register-location',
      testMatch: 'api/register-location.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'api-chat-read-receipts',
      testMatch: 'api/chat-read-receipts.spec.ts',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },

    // ── Browser tests against the Next.js web app ────────────────────────────
    {
      name: 'web-auth-pages',
      testMatch: 'web/auth-pages.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_BASE_URL,
      },
    },
  ],
});
