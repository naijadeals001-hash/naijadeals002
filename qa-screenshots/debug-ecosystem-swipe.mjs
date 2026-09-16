import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function cdpSwipe(client, x1, y1, x2, y2, steps = 12) {
  const dx = (x2 - x1) / steps;
  const dy = (y2 - y1) / steps;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + dx * i, y: y1 + dy * i, id: 1 }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  for (const id of ['carousel-track-ecosystem', 'carousel-track-limited-time']) {
    const track = page.locator('#' + id);
    await track.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await track.boundingBox();
    const meta = await page.evaluate((elId) => {
      const el = document.getElementById(elId);
      const rect = el.getBoundingClientRect();
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, childCount: el.children.length };
    }, id);
    console.log(id, 'box:', box, 'meta:', meta);

    // Check what element is actually at the touch start point (maybe something overlaps)
    const elementAtPoint = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.outerHTML.slice(0, 150) : null;
    }, { x: box.x + box.width - 40, y: box.y + box.height / 2 });
    console.log('element at touch start point:', elementAtPoint);

    const before = await page.evaluate((elId) => document.getElementById(elId).scrollLeft, id);
    await cdpSwipe(client, box.x + box.width - 40, box.y + box.height / 2, box.x + 10, box.y + box.height / 2, 15);
    await page.waitForTimeout(700);
    const after = await page.evaluate((elId) => document.getElementById(elId).scrollLeft, id);
    console.log(id, 'scrollLeft before/after:', before, after);
    console.log('---');
  }

  await ctx.close();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
