// Engine 12 Legacy Remediation — real Playwright/Chromium browser verification.
// Verifies homepage Hero Campaign rendering and Top Brands merchandising
// display (the two UI-facing systems touched by this remediation pass).
// Run: node scripts/verify_engine12_remediation.cjs <baseUrl>
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });

  const results = {};

  // ---------- Hero Campaign Carousel ----------
  results.heroSectionPresent = (await page.$('#hero-carousel')) !== null;
  results.heroDesktopPanelCount = (await page.$$('.hero-panel')).length;
  results.heroTitles = await page.$$eval('[data-hero-title]', (els) => els.map((e) => e.textContent.trim()));
  results.heroImagesLoaded = await page.$$eval('#hero-grid img[data-hero-img]', (els) =>
    els.map((e) => ({ src: e.getAttribute('src'), naturalWidth: e.naturalWidth, complete: e.complete }))
  );
  results.heroCtaButtons = (await page.$$('[data-hero-cta]')).length;

  // ---------- Top Brands merchandising ----------
  const brandImgs = await page.$$eval('img[src*="/static/brands/"]', (els) =>
    els.map((e) => ({ src: e.getAttribute('src'), alt: e.getAttribute('alt') }))
  );
  results.brandLogoCount = brandImgs.length;
  results.brandLogoSrcs = brandImgs.slice(0, 5).map((b) => b.src);

  // ---------- Mobile viewport check (hero carousel responsive behavior) ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  results.mobileHeroVisible = await page.locator('#hero-mobile-carousel').isVisible();
  results.desktopGridHiddenOnMobile = !(await page.locator('#hero-grid').isVisible());

  results.consoleErrors = consoleErrors;

  await page.screenshot({ path: '/tmp/engine12_verify_mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/engine12_verify_desktop.png' });

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
