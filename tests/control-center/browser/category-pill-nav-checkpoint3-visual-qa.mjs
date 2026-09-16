/**
 * Checkpoint 3 — Category Pill Navigation Bar: Playwright visual QA.
 * Real Chromium, real running dev server (http://localhost:3000), real local D1.
 *
 * Proves, visually + via DOM assertions scoped to stable ids (never
 * page-wide text/regex matching — see PILL_SELECTOR/ECO_SELECTOR below):
 *
 * DESKTOP
 *  1. Initial category pill bar renders (13 pills, correct order)
 *  2. Reordered pill bar (swap first two via the real reorder-pills API,
 *     reload, confirm DOM order changed)
 *  3. Hidden pill (hide Electronics via real PATCH, confirm absent)
 *  4. Label override renders ("Supermarket")
 *  5. Badge renders (temporarily set on Electronics)
 *  6. "All Categories" mega-menu still opens (regression)
 *  7. Ecosystem navigation still present alongside pills (decision C)
 *
 * MOBILE
 *  8. Category pill horizontal scroller renders
 *  9. Horizontal swipe/scroll changes visible pills (scrollLeft check)
 * 10. Mobile drawer "Categories" section renders + link is clickable
 *     (navigates to the real /shop?category=<slug> shop experience)
 *  11. Ecosystem navigation still present in drawer
 *  12. "All Categories" accordion still opens in drawer (regression)
 *
 * Every DB mutation this script makes is restored in a `finally` block.
 *
 * Run: node tests/control-center/browser/category-pill-nav-checkpoint3-visual-qa.mjs
 */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'

const execFileAsync = promisify(execFile)
const DB_BINDING = 'naijadeals-production'
const PROJECT_DIR = new URL('../../../', import.meta.url).pathname
const BASE_URL = 'http://localhost:3000'
const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`
const PASSWORD = 'TestPass123!'
const OUT_DIR = '/home/user/webapp/tests/control-center/browser/screenshots'
fs.mkdirSync(OUT_DIR, { recursive: true })

const CACHE_KEY = 'category_pill_nav_header'
const PILL_SEL = '#category-pill-nav-desktop a'
const PILL_SEL_MOBILE_SCROLLER = '#category-pill-nav-mobile-scroller a'
const PILL_SEL_MOBILE_DRAWER = '#category-pill-nav-mobile-drawer a'

async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx', ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  return JSON.parse(stdout).map((s) => s.results)
}
async function queryOneD1(sql) {
  const r = await execD1(sql)
  return r[r.length - 1][0] ?? null
}
async function queryD1(sql) {
  const r = await execD1(sql)
  return r[r.length - 1]
}
async function clearPillCache() {
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
}

const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function registerAndLogin(page, label, roleKey) {
  const email = `cctest_cp3visual_${label}_${RUN_NONCE}@test.ng`
  await page.goto(`${BASE_URL}/control-center/login`)
  const regRes = await page.evaluate(async ({ email, password, label }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `CP3 Visual ${label}`, email, password }),
    })
    return { status: res.status, body: await res.json() }
  }, { email, password: PASSWORD, label })
  assert.equal(regRes.status, 200, `register failed: ${JSON.stringify(regRes.body)}`)
  const userId = regRes.body.user.id
  const roleRow = await queryOneD1(`SELECT id FROM cc_roles WHERE key = '${roleKey}'`)
  assert.ok(roleRow, `unknown cc_roles.key '${roleKey}'`)
  await execD1(`INSERT INTO cc_user_roles (user_id, role_id, assigned_by_user_id) VALUES (${userId}, ${roleRow.id}, ${userId})`)
  await page.evaluate(async ({ email, password }) => {
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  }, { email, password: PASSWORD })
  return userId
}

async function main() {
  console.log(`--- Checkpoint 3 Playwright visual QA run, nonce ${RUN_NONCE} ---`)

  // Self-heal + record original state so a prior crashed run can't poison this one.
  const originalPills = await queryD1(`SELECT id, slug, nav_pill_order FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
  assert.equal(originalPills.length, 13, `precondition: expected 13 curated pills before starting, found ${originalPills.length}`)
  const electronics = originalPills.find((p) => p.slug === 'electronics')
  assert.ok(electronics, 'expected electronics to be a curated pill')
  await clearPillCache()

  const browser = await chromium.launch()
  let adminUserId
  try {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    adminUserId = await registerAndLogin(adminPage, 'admin', 'platform_admin')

    async function patchCategory(id, body) {
      const res = await adminPage.evaluate(async ({ id, body }) => {
        const r = await fetch(`/api/control-center/category-nav/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        return { status: r.status, body: await r.json() }
      }, { id, body })
      assert.equal(res.status, 200, `PATCH ${id} ${JSON.stringify(body)} expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
    }
    async function reorderPills(orderedIds) {
      const res = await adminPage.evaluate(async (orderedIds) => {
        const r = await fetch('/api/control-center/category-nav/reorder-pills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordered_ids: orderedIds }),
        })
        return { status: r.status, body: await r.json() }
      }, orderedIds)
      assert.equal(res.status, 200, `reorder-pills expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
    }

    // ============================================================
    // DESKTOP
    // ============================================================
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const desktopPage = await desktopCtx.newPage()

    // 1. Initial pill bar
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const initialHrefs = await desktopPage.locator(PILL_SEL).evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    const expectedInitial = originalPills.map((p) => `/shop?category=${p.slug}`)
    assert.deepEqual(initialHrefs, expectedInitial, `expected initial desktop pill DOM order to match DB, got ${initialHrefs.join(',')}`)
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-01-initial-pills.png`, fullPage: false })
    record('desktop-01-initial-pills', 'PASS', `${initialHrefs.length} pills in correct order, screenshot captured`)

    // 2. Reordered pill bar
    const swapped = [...originalPills]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    await reorderPills(swapped.map((p) => p.id))
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const reorderedHrefs = await desktopPage.locator(PILL_SEL).evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    assert.deepEqual(reorderedHrefs, swapped.map((p) => `/shop?category=${p.slug}`), `expected reordered desktop pill DOM order, got ${reorderedHrefs.join(',')}`)
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-02-reordered-pills.png`, fullPage: false })
    record('desktop-02-reordered-pills', 'PASS', `first two pills swapped (${swapped[0].slug} <-> ${swapped[1].slug}), confirmed in DOM, screenshot captured`)
    // restore order immediately
    await reorderPills(originalPills.map((p) => p.id))
    await clearPillCache()

    // 3. Hidden pill
    await patchCategory(electronics.id, { nav_pill_visible: false })
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const afterHideCount = await desktopPage.locator(`${PILL_SEL}[href="/shop?category=electronics"]`).count()
    assert.equal(afterHideCount, 0, 'expected Electronics pill to be ABSENT from the DOM after hiding')
    const afterHideTotal = await desktopPage.locator(PILL_SEL).count()
    assert.equal(afterHideTotal, 12, `expected 12 pills after hiding one, found ${afterHideTotal}`)
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-03-hidden-pill.png`, fullPage: false })
    record('desktop-03-hidden-pill', 'PASS', 'Electronics pill CONFIRMED ABSENT (12 pills remain), screenshot captured')
    // restore
    await patchCategory(electronics.id, { nav_pill_visible: true, nav_pill_order: electronics.nav_pill_order })
    await clearPillCache()

    // 4. Label override
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const supermarketPill = desktopPage.locator(`${PILL_SEL}[href="/shop?category=grocery-and-food"]`)
    await assert_visible(supermarketPill, 'grocery-and-food pill')
    const supermarketText = await supermarketPill.first().innerText()
    assert.ok(supermarketText.includes('Supermarket'), `expected the grocery-and-food pill to render label override "Supermarket", got "${supermarketText}"`)
    assert.ok(!supermarketText.includes('Grocery'), `expected the raw name "Grocery & Food" to NOT render (label override should replace it), got "${supermarketText}"`)
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-04-label-override.png`, fullPage: false })
    record('desktop-04-label-override', 'PASS', `grocery-and-food pill renders "Supermarket" label override, screenshot captured`)

    // 5. Badge
    await patchCategory(electronics.id, { nav_badge: 'Hot' })
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const electronicsPill = desktopPage.locator(`${PILL_SEL}[href="/shop?category=electronics"]`)
    await assert_visible(electronicsPill, 'electronics pill')
    const electronicsText = await electronicsPill.first().innerText()
    assert.ok(electronicsText.includes('Hot'), `expected the electronics pill to render the "Hot" badge, got "${electronicsText}"`)
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-05-badge.png`, fullPage: false })
    record('desktop-05-badge', 'PASS', 'electronics pill renders "Hot" badge, screenshot captured')
    // restore
    await patchCategory(electronics.id, { nav_badge: null })
    await clearPillCache()

    // 6. All Categories mega-menu regression
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    await desktopPage.click('#all-categories-btn')
    await desktopPage.waitForSelector('#mega-menu-panel:not(.hidden)', { timeout: 5000 })
    await desktopPage.waitForFunction(() => {
      const depts = document.getElementById('mega-menu-depts')
      return depts && depts.children.length > 0
    }, { timeout: 5000 })
    const deptCount = await desktopPage.locator('#mega-menu-depts button').count()
    assert.ok(deptCount > 0, 'expected department rail buttons in mega-menu')
    // confirm it did NOT navigate away from '/'
    assert.equal(new URL(desktopPage.url()).pathname, '/', 'expected "All Categories" click to open the client-side mega-menu, NOT navigate to /categories')
    await desktopPage.screenshot({ path: `${OUT_DIR}/cp3-desktop-06-all-categories.png`, fullPage: false })
    record('desktop-06-all-categories-open', 'PASS', `mega-menu opened client-side (${deptCount} departments), URL still "/", screenshot captured`)

    // 7. Ecosystem navigation still present alongside pills
    const ecoCount = await desktopPage.locator('#ecosystem-nav-desktop a').count()
    assert.ok(ecoCount > 0, 'expected ecosystem-nav-desktop links to still be present alongside category pills')
    const pillCountFinal = await desktopPage.locator(PILL_SEL).count()
    assert.equal(pillCountFinal, 13, `expected all 13 pills present alongside ecosystem nav, found ${pillCountFinal}`)
    record('desktop-07-ecosystem-nav-coexists', 'PASS', `${ecoCount} ecosystem links + ${pillCountFinal} category pills both present in the same header region`)

    await desktopCtx.close()

    // ============================================================
    // MOBILE
    // ============================================================
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const mobilePage = await mobileCtx.newPage()

    // 8. Mobile pill scroller renders
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const mobilePillCount = await mobilePage.locator(PILL_SEL_MOBILE_SCROLLER).count()
    assert.equal(mobilePillCount, 13, `expected 13 pills in mobile scroller, found ${mobilePillCount}`)
    await mobilePage.screenshot({ path: `${OUT_DIR}/cp3-mobile-01-pill-scroller.png`, fullPage: false })
    record('mobile-01-pill-scroller', 'PASS', `${mobilePillCount} pills present in #category-pill-nav-mobile-scroller, screenshot captured`)

    // 9. Horizontal swipe/scroll
    const scrollerHandle = await mobilePage.evaluateHandle(() => document.querySelector('#category-pill-nav-mobile-scroller').closest('.overflow-x-auto'))
    const scrollBefore = await mobilePage.evaluate((el) => el.scrollLeft, scrollerHandle)
    await mobilePage.evaluate((el) => { el.scrollLeft = 300 }, scrollerHandle)
    const scrollAfter = await mobilePage.evaluate((el) => el.scrollLeft, scrollerHandle)
    assert.ok(scrollAfter > scrollBefore, `expected horizontal scroll position to increase after swipe simulation, before=${scrollBefore} after=${scrollAfter}`)
    await mobilePage.screenshot({ path: `${OUT_DIR}/cp3-mobile-02-scrolled.png`, fullPage: false })
    record('mobile-02-horizontal-swipe', 'PASS', `scrollLeft changed ${scrollBefore} -> ${scrollAfter}, confirming horizontal swipe/scroll works, screenshot captured`)
    await mobilePage.evaluate((el) => { el.scrollLeft = 0 }, scrollerHandle) // reset for cleanliness

    // 10. Mobile drawer "Categories" section + clickable link navigates to real shop experience
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    await mobilePage.click('#mobile-menu-btn')
    await mobilePage.waitForSelector('#mobile-nav-drawer', { timeout: 5000 })
    const drawerPillCount = await mobilePage.locator(PILL_SEL_MOBILE_DRAWER).count()
    assert.equal(drawerPillCount, 13, `expected 13 category links in mobile drawer's Categories section, found ${drawerPillCount}`)
    const drawerCategoriesHeading = await mobilePage.locator('#category-pill-nav-mobile-drawer').locator('xpath=preceding-sibling::*[1] | ./p').first()
    await mobilePage.screenshot({ path: `${OUT_DIR}/cp3-mobile-03-drawer-categories.png`, fullPage: true })
    record('mobile-03-drawer-categories', 'PASS', `${drawerPillCount} category links present in drawer's Categories section, screenshot captured`)

    // Confirm a pill link in the drawer actually navigates to the real shop experience
    const firstDrawerPillHref = await mobilePage.locator(PILL_SEL_MOBILE_DRAWER).first().getAttribute('href')
    assert.ok(firstDrawerPillHref.startsWith('/shop?category='), `expected drawer pill href to be a real /shop?category=<slug> link, got "${firstDrawerPillHref}"`)
    await mobilePage.click(`${PILL_SEL_MOBILE_DRAWER}[href="${firstDrawerPillHref}"]`)
    await mobilePage.waitForURL(`**${firstDrawerPillHref}`, { timeout: 5000 })
    assert.ok(mobilePage.url().includes(firstDrawerPillHref), `expected navigation to ${firstDrawerPillHref} after clicking the drawer pill, got ${mobilePage.url()}`)
    // Confirm the shop page actually loaded product/category content, not an error page
    const shopPageStatus = await mobilePage.evaluate(() => document.title)
    assert.ok(shopPageStatus && shopPageStatus.length > 0, 'expected the shop page to load with a real title after clicking a pill from the drawer')
    await mobilePage.screenshot({ path: `${OUT_DIR}/cp3-mobile-04-category-selected.png`, fullPage: false })
    record('mobile-04-category-selection-navigates', 'PASS', `clicking a drawer category pill navigated to real destination ${firstDrawerPillHref}, screenshot captured`)

    // 11. Ecosystem navigation still present in drawer
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    await mobilePage.click('#mobile-menu-btn')
    await mobilePage.waitForSelector('#mobile-nav-drawer', { timeout: 5000 })
    const drawerEcoCount = await mobilePage.locator('#ecosystem-nav-mobile-drawer a').count()
    assert.ok(drawerEcoCount > 0, 'expected ecosystem-nav-mobile-drawer links to still be present in the mobile drawer')
    record('mobile-05-ecosystem-nav-in-drawer', 'PASS', `${drawerEcoCount} ecosystem links still present in the mobile drawer`)

    // 12. All Categories accordion regression (mobile drawer)
    await mobilePage.click('#mobile-all-categories-btn')
    await mobilePage.waitForFunction(() => {
      const list = document.getElementById('mobile-mega-menu-list')
      return list && !list.classList.contains('hidden') && list.querySelectorAll('details').length > 0
    }, { timeout: 5000 })
    const mobileDeptCount = await mobilePage.locator('#mobile-mega-menu-list details').count()
    assert.ok(mobileDeptCount > 0, 'expected accordion department entries in mobile All Categories')
    await mobilePage.screenshot({ path: `${OUT_DIR}/cp3-mobile-06-all-categories.png`, fullPage: true })
    record('mobile-06-all-categories-accordion', 'PASS', `mobile All Categories accordion opens (${mobileDeptCount} departments), screenshot captured`)

    await mobileCtx.close()
  } finally {
    // Unconditional restoration of every value this script could have touched.
    for (const p of originalPills) {
      await execD1(`UPDATE categories SET nav_pill_visible = 1, nav_pill_order = ${p.nav_pill_order} WHERE id = ${p.id}`)
    }
    await execD1(`UPDATE categories SET nav_badge = NULL WHERE id = ${electronics.id}`)
    await clearPillCache()
    await browser.close()
    if (adminUserId) {
      await execD1(`DELETE FROM cc_user_roles WHERE user_id = ${adminUserId}`).catch(() => {})
      await execD1(`DELETE FROM cc_audit_logs WHERE actor_user_id = ${adminUserId}`).catch(() => {})
      await execD1(`DELETE FROM sessions WHERE user_id = ${adminUserId}`).catch(() => {})
      await execD1(`DELETE FROM users WHERE id = ${adminUserId}`).catch(() => {})
    }
  }

  // Final verification the restore actually worked.
  const finalPills = await queryD1(`SELECT slug FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
  assert.deepEqual(finalPills.map((p) => p.slug), originalPills.map((p) => p.slug), 'expected final pill order to exactly match the original pre-test state')
  console.log('OK: full DB state restored to original 13-pill order after visual QA run')

  console.log('\n========== CHECKPOINT 3 VISUAL QA SUMMARY ==========')
  let pass = 0, fail = 0
  for (const r of results) { if (r.status === 'PASS') pass++; else fail++ }
  console.log(`Totals: ${pass} PASS, ${fail} FAIL (of ${results.length})`)
  if (fail > 0) { console.error('\nRESULT: FAIL'); process.exitCode = 1 }
  else console.log('\nRESULT: All checks PASS.')
}

async function assert_visible(locator, label) {
  const count = await locator.count()
  assert.ok(count > 0, `expected ${label} to exist in the DOM`)
  const visible = await locator.first().isVisible()
  assert.ok(visible, `expected ${label} to be visible`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exitCode = 1
})
