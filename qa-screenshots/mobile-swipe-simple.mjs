import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  const rails = [
    ['carousel-track-ecosystem', 'Ecosystem'],
    ['carousel-track-shop-by-category', 'Shop by Category'],
    ['carousel-track-popular-categories', 'Popular Categories'],
    ['carousel-track-todays-deals', "Today's Deals"],
    ['carousel-track-recommended', 'Recommended for You'],
    ['carousel-track-limited-time', 'Limited-Time Deals']
  ];

  const results = [];
  for (const [id, label] of rails) {
    const r = await page.evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return { status: 'MISSING' };
      const before = el.scrollLeft;
      el.scrollLeft = before + 200;
      return { status: 'TESTED', before, canScroll: el.scrollWidth > el.clientWidth + 5 };
    }, id);
    if (r.status === 'TESTED') {
      await page.waitForTimeout(400);
      const after = await page.evaluate((elId) => document.getElementById(elId).scrollLeft, id);
      r.after = after;
      r.moved = after !== r.before;
      // reset
      await page.evaluate((elId) => { document.getElementById(elId).scrollLeft = 0; }, id);
    }
    results.push({ label, ...r });
  }
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
