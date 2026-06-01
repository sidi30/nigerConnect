/**
 * TARGET 3 — Web Auth Pages (headless Chromium)
 *
 * Tests the auth-related pages in apps/web (Next.js marketing + legal site):
 *   - /reset-password  — password-reset UI (client component)
 *   - /verify-email    — email verification (server component)
 *
 * These pages are part of the auth surface because they are linked from
 * transactional emails sent by the NestJS API. A crash or blank render here
 * breaks password reset and email verification flows entirely.
 *
 * We use waitUntil: 'commit' (first byte received) rather than 'load' because:
 *   1. The served CSP includes `upgrade-insecure-requests` and preloads fonts
 *      from fonts.gstatic.com — both block the `load` event in a CI/dev env
 *      with no internet access for external CDN assets.
 *   2. The meaningful content is in the initial HTML (SSR/SSG), so we assert
 *      against the DOM once committed, not once every external resource loaded.
 *
 * We then wait for the specific heading to be visible, which is the correct
 * web-first assertion pattern.
 *
 * The web server must be running on WEB_BASE_URL (default http://localhost:3001).
 */

import { test, expect } from '@playwright/test';

const NAV_OPTIONS = {
  waitUntil: 'commit' as const,
  timeout: 15_000,
};

// ── /reset-password ──────────────────────────────────────────────────────────

test.describe('/reset-password', () => {

  test('page responds 200 — basic availability', async ({ page }) => {
    const res = await page.goto('/reset-password', NAV_OPTIONS);
    expect(res?.status(), '/reset-password must return 200').toBe(200);
  });

  test('without token param: renders "Lien incomplet" error state', async ({ page }) => {
    await page.goto('/reset-password', NAV_OPTIONS);
    // React hydrates and the missing-token branch renders
    await expect(
      page.getByRole('heading', { name: /lien incomplet/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('with a token param: renders the new-password form', async ({ page }) => {
    await page.goto('/reset-password?token=fake-token-for-ui-test', NAV_OPTIONS);
    await expect(
      page.getByRole('heading', { name: /nouveau mot de passe/i }),
    ).toBeVisible({ timeout: 10_000 });
    // The labels in this component are not associated via htmlFor, so we locate
    // the password inputs by type. Both must be visible.
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').nth(1)).toBeVisible();
    await expect(page.getByRole('button', { name: /mettre à jour/i })).toBeVisible();
  });

  test('submit button is disabled when no password entered', async ({ page }) => {
    await page.goto('/reset-password?token=fake-token', NAV_OPTIONS);
    // Wait for React to hydrate (button renders in client component)
    await expect(
      page.getByRole('button', { name: /mettre à jour/i }),
    ).toBeDisabled({ timeout: 10_000 });
  });

  test('submit button enables only when strong password + confirm match', async ({ page }) => {
    await page.goto('/reset-password?token=valid-token-abc', NAV_OPTIONS);

    // Wait for the form to hydrate
    await expect(page.getByRole('button', { name: /mettre à jour/i })).toBeVisible({ timeout: 10_000 });

    // Labels are not htmlFor-associated in this component; use type locator
    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill('StrongPass#99!');
    await inputs.nth(1).fill('StrongPass#99!');

    await expect(
      page.getByRole('button', { name: /mettre à jour/i }),
    ).toBeEnabled({ timeout: 5_000 });
  });
});

// ── /verify-email ────────────────────────────────────────────────────────────

test.describe('/verify-email', () => {

  test('page responds 200 — basic availability', async ({ page }) => {
    const res = await page.goto('/verify-email', NAV_OPTIONS);
    expect(res?.status(), '/verify-email must return 200').toBe(200);
  });

  test('without token param: shows "Vérification impossible" with token-missing message', async ({ page }) => {
    await page.goto('/verify-email', NAV_OPTIONS);
    await expect(
      page.getByRole('heading', { name: /vérification impossible/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/token manquant/i)).toBeVisible();
  });

  test('with an invalid token: shows failure UI without crashing', async ({ page }) => {
    // /verify-email is force-dynamic and does a server-side fetch.
    // Pass waitUntil:'commit' so we don't wait for the slow SSR fetch.
    await page.goto('/verify-email?token=invalid-token-xyz', {
      waitUntil: 'commit',
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { name: /vérification impossible/i }),
    ).toBeVisible({ timeout: 20_000 });
    // Shows guidance to re-request from app
    await expect(page.getByText(/paramètres/i)).toBeVisible();
  });

  test('page always renders a "Retour" link back to home', async ({ page }) => {
    await page.goto('/verify-email', NAV_OPTIONS);
    await expect(
      page.getByRole('link', { name: /retour/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
