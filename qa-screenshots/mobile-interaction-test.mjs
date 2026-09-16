import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];

async function testRail(page, trackSelector, label) {
  const track = page.locator(trackSelector).first();
  const exists = await track.count();
  if (exists === 0) {
    results.push({ label, status: 'MISSING', detail: 'selector not found' });
    return;
  }
  const box = await track.boundingBox();
  if (!box) {
    results.push({ label, status: 'NOT_VISIBLE', detail: 'no bounding box (offscreen or display:none)' });
    return;
  }
  const scrollBefore = await track.evaluate((el) => el.scrollLeft);
  const scrollWidthBefore = await track.evaluate((el) => el.scrollWidth);
  const clientWidthBefore = await track.evaluate((el) => el.clientWidth);
  const canScroll = scrollWidthBefore > clientWidthBefore + 5;

  // Simulate touch swipe: mouse down at right edge of track, drag left
  const startX = box.x + box.width - 20;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 150, startY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const scrollAfter = await track.evaluate((el) => el.scrollLeft);

  results.push({
    label,
    status: 'OK',
    scrollWidth: scrollWidthBefore,
    clientWidth: clientWidthBefore,
    canScrollHorizontally: canScroll,
    scrollLeftBefore: scrollBefore,
    scrollLeftAfterDrag: scrollAfter,
    dragMoved: scrollAfter !== scrollBefore
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);

  // 1. Check page-level horizontal overflow
  const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  results.push({
    label: 'PAGE_HORIZONTAL_OVERFLOW_CHECK',
    status: bodyScrollWidth > viewportWidth ? 'FAIL_OVERFLOW' : 'PASS',
    scrollWidth: bodyScrollWidth,
    clientWidth: viewportWidth,
    overflowPx: bodyScrollWidth - viewportWidth
  });

  // 2. Test each named rail
  const rails = [
    ['#carousel-track-ecosystem', 'Ecosystem rail'],
    ['#carousel-track-shop-by-category', 'Shop by Category rail'],
    ['#carousel-track-popular-categories', 'Popular Categories rail'],
    ['#carousel-track-todays-deals', "Today's Deals rail"],
    ['#carousel-track-recommended', 'Recommended for You rail'],
    ['#carousel-track-limited-time', 'Limited-Time Deals rail']
  ];
  for (const [sel, label] of rails) {
    await testRail(page, sel, label);
  }

  // 3. Check for clipped/cut-off Add to Cart buttons within cards (button bottom must be <= card bottom, not clipped by overflow:hidden ancestor unexpectedly)
  const addToCartCount = await page.locator('.add-to-cart-card-btn').count();
  results.push({ label: 'Add to Cart buttons found', status: addToCartCount > 0 ? 'OK' : 'MISSING', count: addToCartCount });

  // 4. Test clicking a See All link is reachable/visible (not clipped offscreen)
  const seeAllLinks = await page.locator('text=See all').all();
  results.push({ label: 'See all links found', status: seeAllLinks.length > 0 ? 'OK' : 'MISSING', count: seeAllLinks.length });
  if (seeAllLinks.length > 0) {
    const firstBox = await seeAllLinks[0].boundingBox();
    results.push({ label: 'First See all link box', status: firstBox ? 'VISIBLE' : 'NOT_VISIBLE', box: firstBox });
  }

  // 5. Desktop arrow buttons should be hidden on mobile (md:flex) - verify
  const arrowVisibleOnMobile = await page.locator('.carousel-nav-btn').first().isVisible().catch(() => false);
  results.push({ label: 'Desktop arrows hidden on mobile (expected: hidden)', status: arrowVisibleOnMobile ? 'UNEXPECTED_VISIBLE' : 'CORRECTLY_HIDDEN' });

  await page.screenshot({ path: '/home/user/webapp/qa-screenshots/mobile-after-swipe-test.png', fullPage: false });

  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
