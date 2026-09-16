import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const pages = [
    ['/', 'homepage'],
    ['/shop', 'shop'],
    ['/seller', 'seller-gateway'],
    ['/ecosystem', 'ecosystem'],
    ['/categories', 'categories']
  ];

  const results = [];
  for (const [path, name] of pages) {
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(500);
      const containerWidth = await page.evaluate(() => {
        const els = document.querySelectorAll('[class*="max-w-"]');
        const widths = new Set();
        els.forEach(el => {
          const m = el.className.match(/max-w-\[(\d+)rem\]/);
          if (m) widths.add(m[1] + 'rem');
        });
        return Array.from(widths);
      });
      await page.screenshot({ path: `/home/user/webapp/qa-screenshots/audit-${name}.png`, fullPage: false });
      results.push({ path, name, status: resp.status(), maxWidthClasses: containerWidth });
    } catch (e) {
      results.push({ path, name, error: e.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
