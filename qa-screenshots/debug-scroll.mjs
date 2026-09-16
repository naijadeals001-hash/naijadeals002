import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);

  const dupCheck = await page.evaluate(() => {
    const all = document.querySelectorAll('#carousel-track-todays-deals');
    return all.length;
  });
  console.log('duplicate id count for todays-deals:', dupCheck);

  const before = await page.evaluate(() => document.getElementById('carousel-track-todays-deals').scrollLeft);
  console.log('before', before);
  await page.evaluate(() => { document.getElementById('carousel-track-todays-deals').scrollLeft = 200; });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.getElementById('carousel-track-todays-deals').scrollLeft);
  console.log('after', after);

  // Try scrollBy / scrollTo
  await page.evaluate(() => { document.getElementById('carousel-track-todays-deals').scrollTo({left: 300, behavior:'instant'}); });
  await page.waitForTimeout(200);
  const after2 = await page.evaluate(() => document.getElementById('carousel-track-todays-deals').scrollLeft);
  console.log('after scrollTo', after2);

  // Check outerHTML snippet
  const html = await page.evaluate(() => document.getElementById('carousel-track-todays-deals').outerHTML.slice(0,300));
  console.log(html);

  await ctx.close();
  await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
