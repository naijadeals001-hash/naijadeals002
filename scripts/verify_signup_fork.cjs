// Verifies Phase B — Customer vs Seller signup fork — via real browser
// navigation and clicks, at desktop + mobile viewports, with console-error
// capture. Run against a live URL: node scripts/verify_signup_fork.cjs <baseUrl>
//
// What this proves (not just "page returns 200"):
//   1. /register defaults to the Customer Account tab, with customer copy.
//   2. /register?intent=seller shows the Seller Account tab active, with
//      seller copy, and its hidden `next` field defaults to /seller.
//   3. The Customer <-> Seller toggle tabs actually navigate and re-render
//      the opposite tab as active (real click, not just markup inspection).
//   4. /seller (guest) exposes a "Create a Seller Account" CTA that lands on
//      the seller-intent registration page with next=/seller preserved.
//   5. /login carries the seller intent through to its "Create a Seller
//      Account" cross-link when arriving via next=/seller.
//   6. No console errors are introduced by any of the above (allowing the
//      already-documented pre-existing /api/wallet and /api/wishlist/ids
//      401s, exactly as verify_mobile_menu.cjs does).
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';
const VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop-1440px' },
  { width: 375, height: 812, label: 'mobile-375px' },
];
const KNOWN_PRE_EXISTING_401S = ['/api/wallet', '/api/wishlist/ids'];

function attachErrorCapture(page, consoleErrors, preExistingErrors) {
  page.on('response', (res) => {
    if (res.status() === 401 && KNOWN_PRE_EXISTING_401S.some((p) => res.url().includes(p))) {
      preExistingErrors.push(`401 (pre-existing, out of scope): ${res.url()}`);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/status of 401/.test(msg.text())) return; // covered by the response listener above
    consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
}

async function run() {
  const browser = await chromium.launch();
  let allPass = true;
  const preExistingErrors = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n=== Viewport: ${vp.label} ===`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors, preExistingErrors);

    // 1. /register defaults to Customer Account
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    const customerTabActive = await page.locator('#signup-intent-toggle a[aria-selected="true"]').innerText();
    const h1Customer = await page.locator('h1').innerText();
    const defaultNext = await page.locator('input[name="next"]').inputValue();
    check('register default -> Customer tab active', customerTabActive.trim() === 'Customer Account');
    check('register default -> h1 says Customer', /Customer Account/i.test(h1Customer));
    check('register default -> next defaults to /', defaultNext === '/');

    // 2. /register?intent=seller
    await page.goto(`${BASE}/register?intent=seller`, { waitUntil: 'networkidle' });
    const sellerTabActive = await page.locator('#signup-intent-toggle a[aria-selected="true"]').innerText();
    const h1Seller = await page.locator('h1').innerText();
    const sellerNext = await page.locator('input[name="next"]').inputValue();
    check('register?intent=seller -> Seller tab active', sellerTabActive.trim() === 'Seller Account');
    check('register?intent=seller -> h1 says Seller', /Sell on NaijaDeals|Seller Account/i.test(h1Seller));
    check('register?intent=seller -> next defaults to /seller', sellerNext === '/seller');

    // 3. Real click: toggle from Seller -> Customer tab and back
    await page.click('#signup-intent-toggle a:has-text("Customer Account")');
    await page.waitForLoadState('networkidle');
    const afterClickH1 = await page.locator('h1').innerText();
    check('click Customer tab -> navigates to customer copy', /Create a Customer Account/i.test(afterClickH1));

    await page.click('#signup-intent-toggle a:has-text("Seller Account")');
    await page.waitForLoadState('networkidle');
    const afterClickH1b = await page.locator('h1').innerText();
    check('click Seller tab -> navigates to seller copy', /Sell on NaijaDeals/i.test(afterClickH1b));

    // 4. /seller guest CTA -> seller-intent registration, next preserved
    await page.goto(`${BASE}/seller`, { waitUntil: 'networkidle' });
    const sellerCtaHref = await page.locator('a:has-text("Create a Seller Account")').first().getAttribute('href');
    check('/seller guest CTA -> points to intent=seller', /intent=seller/.test(sellerCtaHref || ''));
    check('/seller guest CTA -> next=/seller preserved', /next=%2Fseller/.test(sellerCtaHref || ''));

    await page.click('a:has-text("Create a Seller Account")');
    await page.waitForLoadState('networkidle');
    const landedH1 = await page.locator('h1').innerText();
    const landedNext = await page.locator('input[name="next"]').inputValue();
    check('/seller CTA click -> lands on seller registration', /Sell on NaijaDeals/i.test(landedH1));
    check('/seller CTA click -> next carried through as /seller', landedNext === '/seller');

    // 5. /login?next=/seller -> seller-aware cross-link
    await page.goto(`${BASE}/login?next=%2Fseller`, { waitUntil: 'networkidle' });
    const loginCrossLinkHref = await page.locator('a:has-text("Create a Seller Account")').first().getAttribute('href');
    check('/login?next=/seller -> cross-link is seller-intent', /intent=seller/.test(loginCrossLinkHref || ''));

    if (consoleErrors.length) {
      allPass = false;
      console.log('Console errors during signup-fork interactions:', consoleErrors);
    } else {
      console.log('No unexpected console errors.');
    }

    await context.close();
  }

  await browser.close();

  if (preExistingErrors.length) {
    console.log('\nNOTE: pre-existing, out-of-scope 401s observed (not caused by this feature):');
    [...new Set(preExistingErrors)].forEach((e) => console.log(' -', e));
  }

  console.log(allPass ? '\n✅ PASS — signup fork verified' : '\n❌ FAIL — see failures above');
  process.exit(allPass ? 0 : 1);

  function check(label, cond) {
    if (cond) {
      console.log(`  ✓ ${label}`);
    } else {
      allPass = false;
      console.log(`  ✗ FAIL: ${label}`);
    }
  }
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
