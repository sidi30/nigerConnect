// Full register → login → /auth/me flow exercised from a real browser context.
const { chromium } = require('playwright');
const PAGE_URL = process.env.PAGE_URL || 'http://localhost:8082/';
const API = 'https://api-nigerconnect.sahabiguide.com';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const out = await page.evaluate(async (api) => {
    const log = [];
    const rand = Math.random().toString(36).slice(2, 10);
    const email = `smoke.${rand}@nigerconnect.test`;
    const password = 'Smoke!Pass1234'; // 12+, upper, digit, special

    let access, refresh, userId;

    try {
      const r = await fetch(`${api}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, password,
          firstName: 'Smoke',
          lastName: 'Test',
          city: 'Niamey',
          countryCode: 'NE',
        }),
      });
      const body = await r.json();
      access = body.tokens?.accessToken;
      refresh = body.tokens?.refreshToken;
      userId = body.user?.id;
      log.push({ step: 'register', status: r.status, userId, hasAccess: !!access, hasRefresh: !!refresh });
    } catch (e) { log.push({ step: 'register', error: String(e) }); }

    if (access) {
      try {
        const r = await fetch(`${api}/api/auth/me`, {
          headers: { Authorization: `Bearer ${access}` },
        });
        const body = await r.json();
        log.push({ step: 'me', status: r.status, email: body.user?.email, role: body.user?.role });
      } catch (e) { log.push({ step: 'me', error: String(e) }); }
    }

    if (refresh) {
      try {
        const r = await fetch(`${api}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        const body = await r.json();
        log.push({ step: 'refresh', status: r.status, gotNewAccess: !!body.tokens?.accessToken, gotNewRefresh: !!body.tokens?.refreshToken });
      } catch (e) { log.push({ step: 'refresh', error: String(e) }); }
    }

    try {
      const r = await fetch(`${api}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.json();
      log.push({ step: 'login', status: r.status, gotAccess: !!body.tokens?.accessToken });
    } catch (e) { log.push({ step: 'login', error: String(e) }); }

    return { email, log };
  }, API);

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
