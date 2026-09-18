// One-off production verification screenshots for the "Category + Footer
// Live Reconciliation" unit (2026-09-18). Read-only: navigates naijadeals.com
// with real Chromium at desktop (1440x900) and mobile (390x844) viewports,
// captures the live pill nav + a previously-broken /shop?category=electronics
// page, and does NOT mutate any production data.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE_URL = 'https://naijadeals.com'
const OUT_DIR = new URL('./screenshots', import.meta.url).pathname
mkdirSync(OUT_DIR, { recursive: true })

async function shootDesktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('#category-pill-nav-desktop', { timeout: 15000 })
  await page.screenshot({ path: `${OUT_DIR}/prod-recon-desktop-01-homepage-pillnav.png`, fullPage: false })
  console.log('[desktop] captured homepage pill nav')

  await page.goto(BASE_URL + '/shop?category=electronics', { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT_DIR}/prod-recon-desktop-02-shop-electronics.png`, fullPage: false })
  console.log('[desktop] captured /shop?category=electronics (bug fix evidence)')

  await ctx.close()
}

async function shootMobile(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  })
  const page = await ctx.newPage()

  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('#category-pill-nav-mobile-scroller', { timeout: 15000 })
  await page.screenshot({ path: `${OUT_DIR}/prod-recon-mobile-01-homepage-pillnav.png`, fullPage: false })
  console.log('[mobile] captured homepage pill nav')

  // Open the mobile categories drawer if a trigger exists
  const drawerTrigger = page.locator('[data-testid="mobile-categories-trigger"], #mobile-categories-trigger, button:has-text("Categories")').first()
  if (await drawerTrigger.count() > 0) {
    await drawerTrigger.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT_DIR}/prod-recon-mobile-02-categories-drawer.png`, fullPage: false })
    console.log('[mobile] captured categories drawer')
  }

  await page.goto(BASE_URL + '/shop?category=electronics', { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT_DIR}/prod-recon-mobile-03-shop-electronics.png`, fullPage: false })
  console.log('[mobile] captured /shop?category=electronics (bug fix evidence)')

  await ctx.close()
}

const browser = await chromium.launch()
try {
  await shootDesktop(browser)
  await shootMobile(browser)
  console.log('ALL PRODUCTION SCREENSHOTS CAPTURED')
} finally {
  await browser.close()
}
