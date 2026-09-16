import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);

  const tracks = [
    'carousel-track-ecosystem',
    'carousel-track-shop-by-category',
    'carousel-track-popular-categories',
    'carousel-track-todays-deals',
    'carousel-track-recommended',
    'carousel-track-limited-time'
  ];

  const report = [];
  for (const id of tracks) {
    const info = await page.evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      // Also check no ancestor blocks overflow/touch-action
      let ancestorBlocking = null;
      let p = el.parentElement;
      while (p) {
        const pcs = getComputedStyle(p);
        if (pcs.overflowX === 'hidden' && p !== document.body) { ancestorBlocking = p.tagName + '.' + p.className; break; }
        p = p.parentElement;
      }
      return {
        found: true,
        overflowX: cs.overflowX,
        touchAction: cs.touchAction,
        scrollSnapType: cs.scrollSnapType,
        webkitOverflowScrolling: cs.webkitOverflowScrolling || 'n/a',
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        ancestorBlocking
      };
    }, id);

    // Programmatically scroll (mimics the DOM-level effect of a real swipe gesture)
    const scrolled = await page.evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return null;
      const before = el.scrollLeft;
      el.scrollLeft = 150;
      const after = el.scrollLeft;
      el.scrollLeft = 0; // reset
      return { before, after, moved: after !== before };
    }, id);

    report.push({ id, ...info, programmaticScrollTest: scrolled });
  }

  console.log(JSON.stringify(report, null, 2));
  await ctx.close();
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
