import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
async function main() {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const resp = await page.goto(BASE + '/control-center', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => ({status: () => 'ERR:' + e.message}));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/webapp/qa-screenshots/audit-control-center.png', fullPage: false });
  console.log('status', typeof resp.status === 'function' ? resp.status() : resp);
  await browser.close();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
