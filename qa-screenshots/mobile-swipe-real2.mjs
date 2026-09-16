import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const results = [];

async function testRailSwipe(page, trackId, label) {
  const track = page.locator('#' + trackId);
  await track.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const before = await page.evaluate((id) => { const el = document.getElementById(id); return el ? el.scrollLeft : null; }, trackId);
  const box = await track.boundingBox();
  if (!box) { results.push({ label, error: 'no box' }); return; }
  const startX = box.x + box.width - 30;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX - i * 20, startY, { steps: 2 });
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate((id) => { const el = document.getElementById(id); return el ? el.scrollLeft : null; }, trackId);
  results.push({ label, before, after, moved: after !== null && before !== null && Math.abs(after - before) > 5 });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('framenavigated', (f) => console.error('NAVIGATED TO:', f.url()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);

  await testRailSwipe(page, 'carousel-track-ecosystem', 'Ecosystem');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); // reset in case navigation occurred
  await page.waitForTimeout(500);
  await testRailSwipe(page, 'carousel-track-shop-by-category', 'Shop by Category');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await testRailSwipe(page, 'carousel-track-popular-categories', 'Popular Categories');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await testRailSwipe(page, 'carousel-track-recommended', 'Recommended for You');

  console.log(JSON.stringify(results, null, 2));
  await ctx.close();
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
