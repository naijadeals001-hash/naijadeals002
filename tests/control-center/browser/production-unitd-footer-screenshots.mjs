// One-off, READ-ONLY Playwright script capturing production naijadeals.com's
// footer for Unit D (Footer Reconciliation, 2026-09-18) live evidence.
// No DB mutation, no navigation beyond the homepage.
import { chromium } from 'playwright'

const BASE_URL = 'https://naijadeals.com'

async function shot(viewport, name) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
  // Scroll to the very bottom so the social-icon row + copyright line (the
  // last elements in the footer) are actually inside the captured viewport,
  // not just the top of the footer.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(500)
  await page.screenshot({
    path: `/home/user/webapp/tests/control-center/browser/screenshots/${name}.png`,
    fullPage: false,
  })
  await browser.close()
  console.log(`saved ${name}`)
}

await shot({ width: 1440, height: 900 }, 'footer-unitd-desktop-1440x900')
await shot({ width: 390, height: 844 }, 'footer-unitd-mobile-390x844')
