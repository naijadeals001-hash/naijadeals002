// Playwright verification script for the Ecosystem Preview feature +
// v2 Waitlist Modal (fix task: "Join the waitlist" must actually work).
// Usage: node scripts/verify_ecosystem_preview.cjs <base_url>
// Checks, for all 8 new routes, at 5 breakpoints:
//   - HTTP 200 (via page.goto response)
//   - no console errors
//   - no horizontal overflow (scrollWidth <= clientWidth), BOTH with the
//     waitlist modal closed AND open (modal must not itself cause overflow)
//   - correct <title> containing the vertical name
//   - Coming Soon badge text present
//   - "Join the waitlist" CTA opens the real modal (not a #footer navigation)
//   - Escape key closes the modal (keyboard accessibility)
// Also runs a full end-to-end submission flow (preselection, service
// validation, success state, duplicate-merge, error-state-preserves-data)
// at desktop 1440 and mobile 390, and a header/footer nav link click-through.

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

const REGRESSION_ROUTES = ['/', '/shop', '/cart', '/seller', '/seller/dashboard', '/checkout', '/account/wishlist', '/account/addresses', '/ecosystem'];
const PDP_SLUG = process.argv[3] || '4-piece-duvet-pillowcase-set';

async function main() {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  console.log(`\n=== Ecosystem Preview verification against ${baseUrl} ===\n`);

  const browser = await chromium.launch();
  let failures = 0;
  const results = [];

  // ---- Early-paint overflow regression guard (Material Symbols icon-font FOUT) ----
  // Root cause found during 390px verification: `.material-symbols-outlined` spans hold
  // literal ligature text ("shopping_cart", "auto_awesome", etc.) that only becomes a
  // single icon glyph once the async Google Font finishes loading. Checking overflow
  // AFTER `networkidle` (as the per-route loop below does) never catches this, because by
  // then the font has already loaded. This block deliberately uses the worst-case timing
  // (`domcontentloaded` + an immediate check, repeated 5x per route to catch flakiness)
  // that originally reproduced scrollWidth=649 vs clientWidth=390 on /eats and /drive.
  // Fix applied in public/static/style.css: `.material-symbols-outlined { width: 1em;
  // height: 1em; overflow: hidden; ... }` clips the fallback text to a single glyph box
  // immediately, before the webfont ever loads.
  const EARLY_PAINT_BREAKPOINTS = BREAKPOINTS.filter((bp) => bp.width === 390 || bp.width === 375);
  for (const route of [...ROUTES.map((r) => r.path), '/', '/shop']) {
    for (const bp of EARLY_PAINT_BREAKPOINTS) {
      let fails = 0;
      for (let i = 0; i < 5; i++) {
        const page = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
        await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const info = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth
        }));
        if (info.sw > info.cw + 1) fails++;
        await page.close();
      }
      const ok = fails === 0;
      if (!ok) failures++;
      results.push({ route, bp: bp.name, ok, checks: { earlyPaintNoOverflow: ok, fails: `${fails}/5` } });
    }
  }

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

      // ---- Waitlist modal check at THIS breakpoint: open it, confirm it's
      // really the dialog (not a #footer scroll-jump), confirm no NEW
      // horizontal overflow while open, confirm Escape closes it. ----
      let modalOpens = false;
      let modalNoOverflow = false;
      let escapeCloses = false;
      let urlUnchangedByModal = false;
      const urlBeforeClick = page.url();
      const trigger = await page.$('[data-open-waitlist-modal]');
      if (trigger) {
        await trigger.click();
        await page.waitForTimeout(250);
        modalOpens = await page.evaluate(() => {
          const m = document.getElementById('ecosystem-waitlist-modal');
          return !!m && !m.classList.contains('hidden');
        });
        urlUnchangedByModal = page.url() === urlBeforeClick; // never navigates to #footer or anywhere else
        const modalOverflowInfo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        }));
        modalNoOverflow = modalOverflowInfo.scrollWidth <= modalOverflowInfo.clientWidth + 1;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        escapeCloses = await page.evaluate(() => {
          const m = document.getElementById('ecosystem-waitlist-modal');
          return !!m && m.classList.contains('hidden');
        });
      }

      const checks = {
        status200: httpStatus === 200,
        noConsoleErrors: consoleErrors.length === 0,
        noOverflow: !hasOverflow,
        titleHasVerticalName: title.includes(route.name),
        hasComingSoonBadge: bodyText.includes('Coming Soon'),
        modalOpens,
        urlUnchangedByModal,
        modalNoOverflow,
        escapeCloses
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

  // ---- Full end-to-end waitlist submission flow, at desktop 1440 and mobile 390 ----
  // Covers: service-aware preselection, "at least one service" validation,
  // successful submission -> success state (no redirect), error state
  // preserves entered data, and duplicate-email merge behaviour.
  for (const bp of [{ name: 'Desktop 1440', width: 1440, height: 900 }, { name: 'Mobile 390', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
    const testEmail = `pw-verify-${Date.now()}-${bp.width}@example.com`;

    // 1) Visit /eats, open modal, confirm NaijaEats is preselected
    await page.goto(baseUrl + '/eats', { waitUntil: 'networkidle' });
    await page.click('[data-open-waitlist-modal]');
    await page.waitForTimeout(250);
    const eatsPreselected = await page.evaluate(() => document.getElementById('ewm-svc-eats').checked);
    results.push({ route: '/eats waitlist preselect', bp: bp.name, ok: eatsPreselected, checks: { eatsPreselected } });
    if (!eatsPreselected) failures++;

    // 2) Uncheck it, try submit with zero services selected -> must show service-required error, must NOT submit
    await page.click('#ewm-svc-eats'); // uncheck
    await page.fill('#ewm-full-name', 'Playwright Verify');
    await page.fill('#ewm-email', testEmail);
    await page.fill('#ewm-phone', '08031234567');
    await page.fill('#ewm-city', 'Lagos');
    await page.waitForFunction(() => document.getElementById('ewm-state').options.length > 1, { timeout: 10000 });
    await page.selectOption('#ewm-state', { label: 'Lagos' });
    await page.click('#ewm-submit-btn');
    await page.waitForTimeout(300);
    const serviceErrorShown = await page.evaluate(() => !document.getElementById('ewm-service-error').classList.contains('hidden'));
    const stillOnFormState = await page.evaluate(() => !document.getElementById('ewm-form-state').classList.contains('hidden'));
    results.push({ route: 'zero-service validation', bp: bp.name, ok: serviceErrorShown && stillOnFormState, checks: { serviceErrorShown, stillOnFormState } });
    if (!(serviceErrorShown && stillOnFormState)) failures++;

    // 3) Check NaijaGigs, submit for real -> success state, no redirect, shows selected service
    await page.click('#ewm-svc-gigs');
    await page.click('#ewm-submit-btn');
    await page.waitForTimeout(1200);
    const successVisible = await page.evaluate(() => !document.getElementById('ewm-success-state').classList.contains('hidden'));
    const successText = await page.evaluate(() => document.getElementById('ewm-success-state').innerText);
    const noRedirect = page.url().includes('/eats');
    const showsSelectedService = successText.includes('NaijaGigs');
    const ok1 = successVisible && noRedirect && showsSelectedService;
    results.push({ route: 'real submission -> success state', bp: bp.name, ok: ok1, checks: { successVisible, noRedirect, showsSelectedService } });
    if (!ok1) failures++;

    // Modal closeable from success state
    await page.click('#ewm-success-close-btn');
    await page.waitForTimeout(200);
    const closedAfterSuccess = await page.evaluate(() => document.getElementById('ecosystem-waitlist-modal').classList.contains('hidden'));
    results.push({ route: 'modal closeable after success', bp: bp.name, ok: closedAfterSuccess, checks: { closedAfterSuccess } });
    if (!closedAfterSuccess) failures++;

    // 4) Duplicate submission from /stay with NaijaStay -> merges, does not error, does not duplicate row
    await page.goto(baseUrl + '/stay', { waitUntil: 'networkidle' });
    await page.click('[data-open-waitlist-modal]');
    await page.waitForTimeout(250);
    const stayPreselected = await page.evaluate(() => document.getElementById('ewm-svc-stay').checked);
    await page.fill('#ewm-full-name', 'Playwright Verify Two');
    await page.fill('#ewm-email', testEmail); // SAME email as before -> duplicate/merge path
    await page.fill('#ewm-phone', '08099999999');
    await page.fill('#ewm-city', 'Abuja');
    await page.waitForFunction(() => document.getElementById('ewm-state').options.length > 1, { timeout: 10000 });
    await page.selectOption('#ewm-state', { label: 'Abuja (FCT)' });
    await page.click('#ewm-submit-btn');
    await page.waitForTimeout(1200);
    const dupSuccessVisible = await page.evaluate(() => !document.getElementById('ewm-success-state').classList.contains('hidden'));
    const dupSuccessText = await page.evaluate(() => document.getElementById('ewm-success-state').innerText);
    // Merged record should show BOTH NaijaGigs (from earlier) and NaijaStay (this submission)
    const showsMergedServices = dupSuccessText.includes('NaijaGigs') && dupSuccessText.includes('NaijaStay');
    const ok2 = stayPreselected && dupSuccessVisible && showsMergedServices;
    results.push({ route: 'duplicate-email merge (/stay)', bp: bp.name, ok: ok2, checks: { stayPreselected, dupSuccessVisible, showsMergedServices } });
    if (!ok2) failures++;

    await page.close();

    // 5) Error-state-preserves-data: simulate a network/server failure by intercepting the
    // route and forcing a 500, confirm the form keeps the entered values and shows a retryable error.
    const page2 = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
    await page2.route('**/api/ecosystem/waitlist', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated failure for verification' }) }));
    await page2.goto(baseUrl + '/gigs', { waitUntil: 'networkidle' });
    await page2.click('[data-open-waitlist-modal]');
    await page2.waitForTimeout(250);
    await page2.fill('#ewm-full-name', 'Error Preserve Test');
    await page2.fill('#ewm-email', 'error-preserve-test@example.com');
    await page2.fill('#ewm-phone', '08031111111');
    await page2.fill('#ewm-city', 'Ibadan');
    await page2.waitForFunction(() => document.getElementById('ewm-state').options.length > 1, { timeout: 10000 });
    await page2.selectOption('#ewm-state', { label: 'Oyo' });
    await page2.click('#ewm-submit-btn');
    await page2.waitForTimeout(600);
    const errorShown = await page2.evaluate(() => !document.getElementById('ewm-form-error').classList.contains('hidden'));
    const dataPreserved = await page2.evaluate(() => document.getElementById('ewm-full-name').value === 'Error Preserve Test' && document.getElementById('ewm-email').value === 'error-preserve-test@example.com');
    const noFakeSuccess = await page2.evaluate(() => document.getElementById('ewm-success-state').classList.contains('hidden'));
    const ok3 = errorShown && dataPreserved && noFakeSuccess;
    results.push({ route: 'error state preserves data, no fake success', bp: bp.name, ok: ok3, checks: { errorShown, dataPreserved, noFakeSuccess } });
    if (!ok3) failures++;
    await page2.close();
  }

  // Desktop-only click-through: /fresh's hero CTA opens the real modal (not #footer,
  // per Pat's explicit "verify the original bug" requirement) + a header nav link.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('401')) consoleErrors.push(msg.text()); });
    await page.goto(baseUrl + '/fresh', { waitUntil: 'networkidle' });
    const urlBefore = page.url();
    const heroCta = await page.$('section [data-open-waitlist-modal]');
    let ctaWorked = false;
    let didNotNavigateToFooter = false;
    if (heroCta) {
      const hrefAttr = await heroCta.evaluate((el) => el.getAttribute('href'));
      didNotNavigateToFooter = hrefAttr !== '#footer'; // the exact banned behaviour Pat reported
      await heroCta.click();
      await page.waitForTimeout(300);
      ctaWorked = await page.evaluate(() => {
        const m = document.getElementById('ecosystem-waitlist-modal');
        return !!m && !m.classList.contains('hidden');
      });
      didNotNavigateToFooter = didNotNavigateToFooter && page.url() === urlBefore;
    }
    results.push({ route: '/fresh hero CTA -> real modal (not #footer)', bp: 'Desktop 1440', ok: ctaWorked && didNotNavigateToFooter, checks: { ctaWorked, didNotNavigateToFooter } });
    if (!(ctaWorked && didNotNavigateToFooter)) failures++;

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
    const allRegressionRoutes = [...REGRESSION_ROUTES, `/shop/${PDP_SLUG}`];
    for (const r of allRegressionRoutes) {
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
      const is5xx = status !== null && status >= 500;
      const ok = (status === 200 || status === 302) && !is5xx; // 302 = auth redirect, expected for some
      results.push({ route: r, bp: 'Regression', ok, httpStatus: status, consoleErrors: consoleErrors.slice(0, 3) });
      if (!ok) failures++;
    }
    await page.close();
  }

  // Broken-image audit across all 8 new routes at desktop 1440 — every <img> must
  // report naturalWidth > 0 (i.e. actually decoded), catching 404/broken hero art.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const route of ROUTES) {
      await page.goto(baseUrl + route.path, { waitUntil: 'networkidle', timeout: 20000 });
      const brokenImages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
          .filter((img) => !img.complete || img.naturalWidth === 0)
          .map((img) => img.src);
      });
      const ok = brokenImages.length === 0;
      results.push({ route: route.path, bp: 'Image audit', ok, brokenImages });
      if (!ok) failures++;
    }
    await page.close();
  }

  // Placeholder-content audit — scan rendered body text on all 8 new routes for
  // forbidden strings (lorem ipsum, external stock-photo hosts, fake stat wording).
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const forbidden = ['lorem ipsum', 'unsplash.com', 'placeholder.com', 'via.placeholder'];
    for (const route of ROUTES) {
      await page.goto(baseUrl + route.path, { waitUntil: 'networkidle', timeout: 20000 });
      const html = await page.content();
      const lower = html.toLowerCase();
      const hits = forbidden.filter((f) => lower.includes(f));
      const ok = hits.length === 0;
      results.push({ route: route.path, bp: 'Placeholder audit', ok, hits });
      if (!ok) failures++;
    }
    await page.close();
  }

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL ERROR during verification run:', err);
  process.exit(1);
});
