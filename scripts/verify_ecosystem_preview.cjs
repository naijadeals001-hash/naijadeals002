// One-off Playwright verification script for the Ecosystem Preview feature.
// Usage: node scripts/verify_ecosystem_preview.cjs <base_url>
// Checks, for all 8 new routes, at 5 breakpoints:
//   - HTTP 200 (via page.goto response)
//   - no console errors
//   - no horizontal overflow (scrollWidth <= clientWidth)
//   - correct <title> containing the vertical name
//   - Coming Soon badge text present
// Also does a lightweight click-through of the waitlist CTA + a header/footer
// nav link click on the desktop breakpoint only (per-route, cheapest signal).

const { chromium } = require('playwright');

const ROUTES = [
  { path: '/fresh', name: 'NaijaFresh' },
  { path: '/eats', name: 'NaijaEats' },
  { path: '/gigs', name: 'NaijaGigs' },
  { path: '/stay', name: 'NaijaStay' },
  { path: '/drive', name: 'NaijaDrive' },
  { path: '/send', name: 'NaijaSend' },
  { path: '/stream', name: 'NaijaStream' },
  { path: '/aura', name: 'Aura AI' }
];

const BREAKPOINTS = [
  { name: 'Desktop 1440', width: 1440, height: 900 },
  { name: 'Desktop 1280', width: 1280, height: 900 },
  { name: 'Mobile 430', width: 430, height: 900 },
  { name: 'Mobile 390', width: 390, height: 900 },
  { name: 'Mobile 375', width: 375, height: 900 }
];

const REGRESSION_ROUTES = ['/', '/shop', '/cart', '/seller', '/checkout', '/account/wishlist', '/account/addresses'];

async function main() {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  console.log(`\n=== Ecosystem Preview verification against ${baseUrl} ===\n`);

  const browser = await chromium.launch();
  let failures = 0;
  const results = [];

  for (const route of ROUTES) {
    for (const bp of BREAKPOINTS) {
      const page = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
      const consoleErrors = [];
      // Known pre-existing noise, unrelated to this feature: Layout.tsx's wallet-balance-nav
      // widget calls GET /api/wallet on EVERY page (including pre-existing routes like /, /shop,
      // /cart) and 401s for guest/unauthenticated visitors — confirmed present identically on
      // those untouched routes, so it is explicitly excluded here as "not caused by the new feature".
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (msg.text().includes('401') ) return;
        consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));

      let httpStatus = null;
      try {
        const resp = await page.goto(baseUrl + route.path, { waitUntil: 'networkidle', timeout: 20000 });
        httpStatus = resp ? resp.status() : null;
      } catch (e) {
        results.push({ route: route.path, bp: bp.name, ok: false, reason: 'goto failed: ' + e.message });
        failures++;
        await page.close();
        continue;
      }

      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText);
      const overflowInfo = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      const hasOverflow = overflowInfo.scrollWidth > overflowInfo.clientWidth + 1; // 1px tolerance

      const checks = {
        status200: httpStatus === 200,
        noConsoleErrors: consoleErrors.length === 0,
        noOverflow: !hasOverflow,
        titleHasVerticalName: title.includes(route.name),
        hasComingSoonBadge: bodyText.includes('Coming Soon')
      };
      const ok = Object.values(checks).every(Boolean);
      if (!ok) failures++;
      results.push({
        route: route.path, bp: bp.name, ok, httpStatus, title,
        overflow: hasOverflow ? `${overflowInfo.scrollWidth}px > ${overflowInfo.clientWidth}px` : 'none',
        consoleErrors: consoleErrors.slice(0, 3),
        checks
      });
      await page.close();
    }
  }

  // Desktop-only click-through: waitlist form + a nav link
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('401')) consoleErrors.push(msg.text()); });
    await page.goto(baseUrl + '/fresh', { waitUntil: 'networkidle' });
    const emailInput = await page.$('.ecosystem-waitlist-form input[name="email"]');
    let ctaWorked = false;
    if (emailInput) {
      await emailInput.fill('playwright-clicktest@example.com');
      await page.click('.ecosystem-waitlist-form button[type="submit"]');
      await page.waitForTimeout(1500);
      const msgText = await page.evaluate(() => {
        const el = document.querySelector('.ecosystem-waitlist-msg');
        return el ? el.textContent : '';
      });
      ctaWorked = msgText.includes('on the list');
    }
    results.push({ route: '/fresh (CTA click)', bp: 'Desktop 1440', ok: ctaWorked, checks: { ctaWorked } });
    if (!ctaWorked) failures++;

    // Header ecosystem nav strip -> click NaijaEats link, confirm we land on /eats
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
    const ecoLink = await page.$('a[href="/eats"]');
    let navWorked = false;
    if (ecoLink) {
      await ecoLink.click();
      await page.waitForLoadState('networkidle');
      navWorked = page.url().endsWith('/eats');
    }
    results.push({ route: 'header nav -> /eats', bp: 'Desktop 1440', ok: navWorked, checks: { navWorked } });
    if (!navWorked) failures++;
    await page.close();
  }

  // Regression routes — smoke test at desktop 1440 only (full existing coverage already exists elsewhere)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const r of REGRESSION_ROUTES) {
      const consoleErrors = [];
      page.removeAllListeners('console');
      page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('401')) consoleErrors.push(msg.text()); });
      let status = null;
      try {
        const resp = await page.goto(baseUrl + r, { waitUntil: 'networkidle', timeout: 20000 });
        status = resp ? resp.status() : null;
      } catch (e) {
        results.push({ route: r, bp: 'Regression', ok: false, reason: e.message });
        failures++;
        continue;
      }
      const ok = status === 200 || status === 302; // 302 = auth redirect, expected for some
      results.push({ route: r, bp: 'Regression', ok, httpStatus: status, consoleErrors: consoleErrors.slice(0, 3) });
      if (!ok) failures++;
    }
    await page.close();
  }

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
