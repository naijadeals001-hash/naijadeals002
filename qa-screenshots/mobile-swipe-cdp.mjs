import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const results = [];

async function cdpSwipe(client, x1, y1, x2, y2, steps = 10) {
  const dx = (x2 - x1) / steps;
  const dy = (y2 - y1) / steps;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x1, y: y1, id: 1 }]
  });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 + dx * i, y: y1 + dy * i, id: 1 }]
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  });
}

async function testRailSwipe(page, client, trackId, label) {
  const track = page.locator('#' + trackId);
  const count = await track.count();
  if (count === 0) { results.push({ label, status: 'MISSING' }); return; }
  await track.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const before = await page.evaluate((id) => document.getElementById(id)?.scrollLeft ?? null, trackId);
  const box = await track.boundingBox();
  if (!box) { results.push({ label, status: 'NOT_VISIBLE' }); return; }
  const startX = box.x + box.width - 40;
  const startY = box.y + box.height / 2;
  const endX = box.x + 20;
  await cdpSwipe(client, startX, startY, endX, startY, 12);
  await page.waitForTimeout(600);
  const urlAfter = page.url();
  const after = await page.evaluate((id) => document.getElementById(id)?.scrollLeft ?? null, trackId);
  results.push({ label, before, after, moved: after !== null && before !== null && Math.abs(after - before) > 5, navigatedAway: urlAfter !== BASE + '/', urlAfter });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);

  const rails = [
    ['carousel-track-ecosystem', 'Ecosystem'],
    ['carousel-track-shop-by-category', 'Shop by Category'],
    ['carousel-track-popular-categories', 'Popular Categories'],
    ['carousel-track-todays-deals', "Today's Deals"],
    ['carousel-track-recommended', 'Recommended for You'],
    ['carousel-track-limited-time', 'Limited-Time Deals']
  ];

  for (const [id, label] of rails) {
    if (page.url() !== BASE + '/') {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
    }
    await testRailSwipe(page, client, id, label);
  }

  console.log(JSON.stringify(results, null, 2));
  await ctx.close();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
