// Real browser CORS test: load the mobile web build, then exercise the prod
// API from inside the page context (so the request goes through the real
// browser CORS pipeline, not curl).
const { chromium } = require('playwright');
const PAGE_URL = process.env.PAGE_URL || 'http://localhost:8082/';
const API = 'https://api-nigerconnect.sahabiguide.com';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Run from the page so the Origin header is http://localhost:8082 — real CORS path.
  const out = await page.evaluate(async (api) => {
    const log = [];
    try {
      const r = await fetch(`${api}/health`, { credentials: 'include' });
      log.push({ step: 'GET /health', status: r.status, body: await r.json().catch(() => '<non-json>') });
    } catch (e) { log.push({ step: 'GET /health', error: String(e) }); }

    try {
      const r = await fetch(`${api}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: 'nobody@invalid.example', password: 'WrongPwd1!' }),
      });
      log.push({ step: 'POST /api/auth/login (wrong creds)', status: r.status, body: await r.text() });
    } catch (e) { log.push({ step: 'POST /api/auth/login', error: String(e) }); }

    try {
      const r = await fetch(`${api}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: '', password: '' }),  // intentionally invalid → 400
      });
      log.push({ step: 'POST /api/auth/register (invalid)', status: r.status, body: await r.text() });
    } catch (e) { log.push({ step: 'POST /api/auth/register', error: String(e) }); }

    return log;
  }, API);

  console.log(JSON.stringify({ tests: out }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
