// Headless smoke test for the Expo web build pointing at the prod API.
const { chromium } = require('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:8081/';
const API_HOST = 'api.nigerconnect.app';
const TIMEOUT_MS = 90_000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  const apiCalls = [];
  const allConsole = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    allConsole.push(`[${msg.type()}] ${msg.text().slice(0, 500)}`);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 600)));

  page.on('request', (req) => {
    if (req.url().includes(API_HOST)) {
      apiCalls.push({ method: req.method(), url: req.url() });
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes(API_HOST)) {
      const i = apiCalls.findIndex((c) => c.url === res.url() && c.status === undefined);
      if (i >= 0) apiCalls[i].status = res.status();
    }
  });

  try {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  } catch (e) {
    console.log('NAVIGATE_ERROR:', e.message);
  }

  // Wait for the app to settle (auth check, fonts, etc.)
  await page.waitForTimeout(8000);

  const title = await page.title();
  const url = page.url();
  const bodyText = (await page.locator('body').innerText()).slice(0, 1000);
  const visibleButtons = await page.locator('button, [role=button]').allInnerTexts();
  await page.screenshot({ path: process.argv[2] || 'mobile-smoke.png', fullPage: true });

  console.log(JSON.stringify({
    finalUrl: url,
    title,
    bodyTextPreview: bodyText,
    visibleButtons: visibleButtons.slice(0, 10),
    apiCalls,
    pageErrors,
    consoleSample: allConsole.slice(0, 25),
    consoleTotal: allConsole.length,
  }, null, 2));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
