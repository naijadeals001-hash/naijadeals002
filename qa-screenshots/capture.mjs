import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch();

  // Desktop 1440
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopCtx.newPage();
  await desktopPage.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await desktopPage.waitForTimeout(1000);
  await desktopPage.screenshot({ path: '/home/user/webapp/qa-screenshots/home-desktop-1440-full.png', fullPage: true });
  // Above the fold only
  await desktopPage.screenshot({ path: '/home/user/webapp/qa-screenshots/home-desktop-1440-fold.png', fullPage: false });
  await desktopCtx.close();

  // Mobile 390
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({ path: '/home/user/webapp/qa-screenshots/home-mobile-390-full.png', fullPage: true });
  await mobileCtx.close();

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
