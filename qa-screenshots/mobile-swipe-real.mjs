import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function swipeTest(page, id, label) {
  const el = page.locator('#' + id);
  const count = await el.count();
  if (count === 0) return { label, status: 'MISSING' };
  const box = await el.boundingBox();
  if (!box) return { label, status: 'NOT_VISIBLE' };

  const before = await el.evaluate((e) => e.scrollLeft);

  const startX = box.x + box.width - 30;
  const startY = box.y + Math.min(box.height / 2, 40);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX - (200 * i) / 10, startY);
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);

  const after = await el.evaluate((e) => e.scrollLeft);

  const progBefore = await el.evaluate((e) => e.scrollLeft);
  await el.evaluate((e) => { e.scrollLeft = e.scrollLeft + 200; });
  await page.waitForTimeout(500);
  const progAfter = await el.evaluate((e) => e.scrollLeft);

  return {
    label,
    status: 'TESTED',
    railWidthPx: Math.round(box.width),
    dragSwipe: { before, after, moved: after !== before },
    programmaticScroll: { before: progBefore, after: progAfter, moved: progAfter !== progBefore }
  };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();

  const results = [];
  const rails = [
    ['carousel-track-ecosystem', 'Ecosystem'],
    ['carousel-track-shop-by-category', 'Shop by Category'],
    ['carousel-track-popular-categories', 'Popular Categories'],
    ['carousel-track-todays-deals', "Today's Deals"],
    ['carousel-track-recommended', 'Recommended for You'],
    ['carousel-track-limited-time', 'Limited-Time Deals']
  ];

  for (const [id, label] of rails) {
    // Reload fresh each time to avoid any navigation side-effects from the previous drag
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    results.push(await swipeTest(page, id, label));
  }
  console.log(JSON.stringify(results, null, 2));

  await ctx.close();
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
