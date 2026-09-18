// Verifies the header category/ecosystem nav strip's scroll affordance fix
// (Category + Footer Live Reconciliation follow-up, 2026-09-18 — Pat: "supposed
// to be able to scroll to the end... when you hover on it, you can scroll to the
// right or left... there should be no cut off"). Read-only, no DB mutation.
import { chromium } from 'playwright'
import assert from 'node:assert'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function run() {
  const browser = await chromium.launch()

  // ---------- DESKTOP ----------
  {
    // Narrow desktop viewport forces the strip to actually overflow, so the
    // fix is meaningfully exercised (a very wide viewport might fit everything).
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
    const page = await ctx.newPage()
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

    const track = page.locator('#header-nav-scroll-track')
    await track.waitFor({ state: 'visible', timeout: 15000 })

    const leftBtn = page.locator('#header-nav-scroll-left-btn')
    const rightBtn = page.locator('#header-nav-scroll-right-btn')
    await leftBtn.waitFor({ state: 'attached' })
    await rightBtn.waitFor({ state: 'attached' })

    // 1. Overflow actually exists at this viewport (precondition for the rest
    //    of this test to mean anything).
    const { scrollWidth, clientWidth } = await track.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    assert.ok(scrollWidth > clientWidth, `expected strip to overflow at 1100px viewport (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`)
    console.log(`[desktop] strip overflows as expected: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`)

    // 2. At start: left button must be disabled (no dead-end arrow), right must be enabled.
    let leftDisabled = await leftBtn.evaluate((el) => el.disabled)
    let rightDisabled = await rightBtn.evaluate((el) => el.disabled)
    assert.equal(leftDisabled, true, 'left scroll button should be disabled at scroll start')
    assert.equal(rightDisabled, false, 'right scroll button should be enabled at scroll start (content overflows)')
    console.log('[desktop] at start: left disabled=true, right disabled=false -- correct')

    // 3. Buttons are invisible (opacity-0) until hover reveals them.
    const rightOpacityBefore = await rightBtn.evaluate((el) => getComputedStyle(el).opacity)
    assert.equal(rightOpacityBefore, '0', `expected right button opacity 0 before hover, got ${rightOpacityBefore}`)
    console.log('[desktop] right button correctly hidden (opacity:0) before hover')

    await track.hover()
    await page.waitForTimeout(350) // transition-opacity duration
    const rightOpacityAfter = await rightBtn.evaluate((el) => getComputedStyle(el).opacity)
    assert.equal(rightOpacityAfter, '1', `expected right button opacity 1 after hovering the strip, got ${rightOpacityAfter}`)
    console.log('[desktop] right button correctly revealed (opacity:1) on hover')

    // 4. Clicking right actually scrolls the track, and left becomes enabled.
    const scrollBefore = await track.evaluate((el) => el.scrollLeft)
    await rightBtn.click()
    await page.waitForTimeout(500) // smooth scroll settle
    const scrollAfterOneClick = await track.evaluate((el) => el.scrollLeft)
    assert.ok(scrollAfterOneClick > scrollBefore, `expected scrollLeft to increase after clicking right (before=${scrollBefore}, after=${scrollAfterOneClick})`)
    console.log(`[desktop] click-right scrolled track: ${scrollBefore} -> ${scrollAfterOneClick}`)

    leftDisabled = await leftBtn.evaluate((el) => el.disabled)
    assert.equal(leftDisabled, false, 'left scroll button should become enabled after scrolling right')
    console.log('[desktop] left button correctly enabled after scrolling right')

    // 5. Scroll all the way to the end via repeated clicks; right must end up disabled
    //    (no dead-end arrow at the far edge either).
    for (let i = 0; i < 15; i++) {
      const stillEnabled = !(await rightBtn.evaluate((el) => el.disabled))
      if (!stillEnabled) break
      await rightBtn.click()
      await page.waitForTimeout(400)
    }
    rightDisabled = await rightBtn.evaluate((el) => el.disabled)
    assert.equal(rightDisabled, true, 'right scroll button should be disabled once the track is fully scrolled to the end')
    const { scrollLeft: finalScrollLeft } = await track.evaluate((el) => ({ scrollLeft: el.scrollLeft }))
    const atEnd = await track.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
    assert.equal(atEnd, true, `expected track to be scrolled to its true end (scrollLeft=${finalScrollLeft})`)
    console.log('[desktop] reached true end of strip -- right button correctly disabled, no cut-off content remains')

    await page.screenshot({ path: new URL('./screenshots/nav-scroll-desktop-01-hover-buttons.png', import.meta.url).pathname })
    await ctx.close()
  }

  // ---------- MOBILE ----------
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    const page = await ctx.newPage()
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

    const mobileTrack = page.locator('#header-nav-scroll-track-mobile')
    await mobileTrack.waitFor({ state: 'visible', timeout: 15000 })

    const { scrollWidth, clientWidth } = await mobileTrack.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    assert.ok(scrollWidth > clientWidth, `expected mobile strip to overflow at 390px viewport (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`)
    console.log(`[mobile] strip overflows as expected: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`)

    const fade = page.locator('[data-nav-fade="right-mobile"]')
    await fade.waitFor({ state: 'attached' })
    const fadeOpacityBefore = await fade.evaluate((el) => getComputedStyle(el).opacity)
    assert.equal(fadeOpacityBefore, '1', `expected mobile edge-fade visible (opacity 1) before scrolling, got ${fadeOpacityBefore}`)
    console.log('[mobile] edge-fade correctly visible before scrolling (signals more content)')

    await mobileTrack.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }))
    await page.waitForTimeout(300)
    const fadeOpacityAfter = await fade.evaluate((el) => getComputedStyle(el).opacity)
    assert.equal(fadeOpacityAfter, '0', `expected mobile edge-fade hidden (opacity 0) once scrolled to the end, got ${fadeOpacityAfter}`)
    console.log('[mobile] edge-fade correctly hidden once scrolled to true end -- no cut-off content remains')

    await page.screenshot({ path: new URL('./screenshots/nav-scroll-mobile-01-fade-behavior.png', import.meta.url).pathname })
    await ctx.close()
  }

  await browser.close()
  console.log('\nALL HEADER NAV SCROLL AFFORDANCE CHECKS PASSED')
}

run().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
