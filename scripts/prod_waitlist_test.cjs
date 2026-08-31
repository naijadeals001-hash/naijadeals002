// Phase 9: mandatory real waitlist production test.
// Drives the ACTUAL live modal UI (not raw API calls) on naijadeals.com.
// Step 1: /eats -> open modal -> submit with identifiable test email -> confirm success
// Step 2: /drive -> open modal -> submit SAME email -> confirm success (merge test)
const { chromium } = require('playwright');

const baseUrl = process.argv[2] || 'https://naijadeals.com';
const TEST_EMAIL = 'taskm-prodtest-20260831@naijadeals-qa-verification.invalid';
const TEST_NAME = 'Task M Prod Verification (DELETE ME)';
const TEST_PHONE = '+2348000000000';

async function submitFromRoute(browser, route, expectedPreselectedLabel) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(baseUrl + route, { waitUntil: 'networkidle', timeout: 30000 });

  // Click the primary "Join the waitlist" CTA (data-open-waitlist-modal)
  const cta = page.locator('[data-open-waitlist-modal="true"]').first();
  await cta.waitFor({ state: 'visible', timeout: 10000 });
  await cta.click();

  const modal = page.locator('#ecosystem-waitlist-modal');
  await modal.waitFor({ state: 'visible', timeout: 5000 });

  // Fill form fields
  await page.fill('#ewm-full-name', TEST_NAME);
  await page.fill('#ewm-email', TEST_EMAIL);
  await page.fill('#ewm-phone', TEST_PHONE);
  await page.fill('#ewm-city', 'Lagos');

  // Try to set state select if present
  const stateSelect = page.locator('#ewm-state');
  try {
    await stateSelect.waitFor({ state: 'attached', timeout: 3000 });
    const options = await stateSelect.locator('option').allTextContents();
    const lagosIdx = options.findIndex((o) => /lagos/i.test(o));
    if (lagosIdx > 0) await stateSelect.selectOption({ index: lagosIdx });
  } catch (e) { /* state select optional */ }

  // Capture which service checkbox is pre-checked (should match the route's vertical)
  const preChecked = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#ecosystem-waitlist-modal input[type="checkbox"]'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.id);
  });

  // Submit
  const submitBtn = modal.locator('button[type="submit"]');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/ecosystem/waitlist') && r.request().method() === 'POST', { timeout: 15000 }),
    submitBtn.click(),
  ]);
  const status = response.status();
  let body = null;
  try { body = await response.json(); } catch (e) { /* ignore */ }

  // Confirm success state appears
  let successVisible = false;
  let successServicesText = null;
  try {
    await page.locator('#ewm-success-state').waitFor({ state: 'visible', timeout: 5000 });
    successVisible = true;
    successServicesText = await page.locator('#ewm-success-services').textContent().catch(() => null);
  } catch (e) { /* not visible */ }

  const result = { route, status, body, preChecked, successVisible, successServicesText, consoleErrors };
  await page.close();
  return result;
}

(async () => {
  const browser = await chromium.launch();
  console.log(`=== Phase 9 Step 1: submit from ${baseUrl}/eats with test email ${TEST_EMAIL} ===`);
  const r1 = await submitFromRoute(browser, '/eats');
  console.log(JSON.stringify(r1, null, 2));

  console.log(`\n=== Phase 9 Step 2: submit SAME email from ${baseUrl}/drive (merge test) ===`);
  const r2 = await submitFromRoute(browser, '/drive');
  console.log(JSON.stringify(r2, null, 2));

  await browser.close();

  const pass = r1.status === 200 && r1.successVisible && r2.status === 200 && r2.successVisible;
  console.log(`\n=== ${pass ? 'PASS' : 'FAIL'} ===`);
  console.log(`TEST_EMAIL_USED=${TEST_EMAIL}`);
  process.exit(pass ? 0 : 1);
})();
