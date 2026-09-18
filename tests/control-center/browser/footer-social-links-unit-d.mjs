// Verifies Unit D (Footer Reconciliation, 2026-09-18): the four real social
// media accounts Pat supplied are wired into the footer, the three
// unconfigured platforms (Facebook/LinkedIn/Pinterest) stay hidden, and
// nothing else about the pre-existing 6-column footer, newsletter, or app
// placeholder was touched. Read-only, no DB mutation.
import { chromium } from 'playwright'
import assert from 'node:assert'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const EXPECTED_LINKS = {
  instagram: 'https://instagram.com/naijadeals1',
  tiktok: 'https://www.tiktok.com/@naijadeals1',
  youtube: 'https://youtube.com/@NaijaDeals1',
  x: 'https://x.com/naijadeals2',
}

const HIDDEN_URL_FRAGMENTS = ['facebook.com', 'linkedin.com', 'pinterest.com']

const EXPECTED_COLUMN_HEADINGS = [
  'Get to Know Us',
  'Customer Service',
  'Payments & Delivery',
  'Ecosystem',
  'Policies',
  'Trust & Safety',
]

async function checkViewport(browser, viewport, label) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

  const footer = page.locator('footer')
  await footer.scrollIntoViewIfNeeded()
  await footer.waitFor({ state: 'visible', timeout: 15000 })

  // 1. Social icon row exists and has EXACTLY 4 links (not 7).
  const socialRow = page.locator('#footer-social-links')
  await socialRow.waitFor({ state: 'visible', timeout: 10000 })
  const socialAnchors = socialRow.locator('a')
  const count = await socialAnchors.count()
  assert.strictEqual(count, 4, `[${label}] expected exactly 4 social icons, found ${count}`)
  console.log(`[${label}] social row has exactly 4 icons (Facebook/LinkedIn/Pinterest correctly absent)`)

  // 2. Each of the 4 real links resolves to the exact href Pat supplied, opens
  //    in a new tab (target=_blank), and has rel=noopener noreferrer.
  const hrefs = await socialAnchors.evaluateAll((els) => els.map((a) => a.getAttribute('href')))
  for (const [platform, expectedUrl] of Object.entries(EXPECTED_LINKS)) {
    assert.ok(hrefs.includes(expectedUrl), `[${label}] expected href ${expectedUrl} (${platform}) in footer social row, got: ${hrefs.join(', ')}`)
  }
  console.log(`[${label}] all 4 expected hrefs present verbatim: ${hrefs.join(', ')}`)

  for (let i = 0; i < count; i++) {
    const a = socialAnchors.nth(i)
    const target = await a.getAttribute('target')
    const rel = await a.getAttribute('rel')
    assert.strictEqual(target, '_blank', `[${label}] social link #${i} must open in new tab`)
    assert.ok(rel && rel.includes('noopener') && rel.includes('noreferrer'), `[${label}] social link #${i} must have rel=noopener noreferrer`)
  }
  console.log(`[${label}] all social links have target=_blank + rel=noopener noreferrer`)

  // 3. Hidden platforms (Facebook/LinkedIn/Pinterest) must not appear anywhere
  //    in the footer's rendered HTML.
  const footerHtml = await footer.innerHTML()
  for (const fragment of HIDDEN_URL_FRAGMENTS) {
    assert.ok(!footerHtml.includes(fragment), `[${label}] footer must NOT contain a link to ${fragment} (Facebook/LinkedIn/Pinterest stay hidden)`)
  }
  console.log(`[${label}] Facebook/LinkedIn/Pinterest confirmed absent from footer HTML`)

  // 4. All 6 existing footer columns remain intact (exact headings, in order).
  const headings = await footer.locator('.grid h4').evaluateAll((els) => els.map((e) => e.textContent?.trim()))
  assert.deepStrictEqual(headings, EXPECTED_COLUMN_HEADINGS, `[${label}] expected exactly 6 unchanged column headings, got: ${headings.join(' | ')}`)
  console.log(`[${label}] all 6 existing footer columns intact and unchanged: ${headings.join(', ')}`)

  // 5. Newsletter form still present and functional (input + gold submit button).
  const newsletterForm = page.locator('#newsletter-form')
  await newsletterForm.waitFor({ state: 'visible', timeout: 10000 })
  const emailInput = newsletterForm.locator('input[type="email"]')
  assert.strictEqual(await emailInput.count(), 1, `[${label}] newsletter email input must exist`)
  const submitBtn = newsletterForm.locator('button[type="submit"]')
  assert.strictEqual(await submitBtn.count(), 1, `[${label}] newsletter submit button must exist`)
  console.log(`[${label}] newsletter form (email input + submit button) intact`)

  // 6. App placeholder remains honest ("coming soon"), no fake store badges.
  const footerText = await footer.innerText()
  assert.ok(footerText.includes('Get the app (coming soon)'), `[${label}] app placeholder text must remain "Get the app (coming soon)"`)
  assert.ok(!footerHtml.toLowerCase().includes('app-store') && !footerHtml.toLowerCase().includes('play-store') && !footerHtml.toLowerCase().includes('googleplay') && !footerHtml.toLowerCase().includes('apple.com/app-store'), `[${label}] must NOT contain fabricated app store badge links`)
  console.log(`[${label}] app placeholder honestly marked "coming soon", no fake store badges`)

  // 7. No /admin links anywhere in the footer.
  assert.ok(!footerHtml.includes('href="/admin') && !footerHtml.includes("href='/admin"), `[${label}] footer must NOT contain any /admin links`)
  console.log(`[${label}] no /admin links present in footer`)

  // 8. Copyright line present (exact current text — Unit D did not change this).
  const copyrightText = await footer.locator('span').first().innerText().catch(() => '')
  assert.ok(footerText.includes('© 2026 NaijaDeals'), `[${label}] copyright line must be present`)
  console.log(`[${label}] copyright line present`)

  await ctx.close()
}

async function run() {
  const browser = await chromium.launch()
  await checkViewport(browser, { width: 1440, height: 900 }, 'desktop-1440x900')
  await checkViewport(browser, { width: 390, height: 844 }, 'mobile-390x844')
  await browser.close()
  console.log('\n✅ ALL UNIT D FOOTER CHECKS PASSED')
}

run().catch((err) => {
  console.error('❌ FAILED:', err.message)
  process.exit(1)
})
