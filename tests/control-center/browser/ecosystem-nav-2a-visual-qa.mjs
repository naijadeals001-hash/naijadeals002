/**
 * Micro-Checkpoint 2A — Playwright visual QA: PROVE the live ecosystem-nav
 * hide/restore toggle visually, on a real Chromium browser, on the actual
 * customer-facing homepage — not just via HTTP/curl (the backend script,
 * verify-ecosystem-nav-2a.mjs, already proves the HTTP-level truth; this
 * script is the visual-demonstration half Pat's spec mandates).
 *
 * Captures 6 screenshots:
 *   1. desktop-01-before-hide.png   — Fresh pill visible (desktop, 1440x900)
 *   2. desktop-02-after-hide.png    — Fresh pill GONE (desktop)
 *   3. desktop-03-after-restore.png — Fresh pill back (desktop)
 *   4. mobile-01-before-hide.png    — Fresh visible in mobile scroller (390x844)
 *   5. mobile-02-after-hide.png     — Fresh GONE from mobile scroller
 *   6. mobile-03-after-restore.png  — Fresh back in mobile scroller
 *
 * Run: node tests/control-center/browser/ecosystem-nav-2a-visual-qa.mjs
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

const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function registerAndLogin(page, label, roleKey) {
  const email = `cctest_2avisual_${label}_${RUN_NONCE}@test.ng`
  await page.goto(`${BASE_URL}/control-center/login`)
  const regRes = await page.evaluate(async ({ email, password, label }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `2A Visual ${label}`, email, password }),
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
  console.log(`--- Micro-Checkpoint 2A Playwright visual QA run, nonce ${RUN_NONCE} ---`)

  // Self-heal: force "fresh" back to visible + clear cache before starting,
  // same discipline as the backend script, so a prior crashed run can't
  // poison this one's starting state.
  await execD1(`UPDATE ecosystem_verticals SET nav_visible = 1 WHERE slug = 'fresh'`)
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
  const target = await queryOneD1(`SELECT id, slug, route, name FROM ecosystem_verticals WHERE slug = 'fresh'`)
  assert.ok(target, 'expected "fresh" vertical to exist')
  console.log(`OK: target vertical "fresh" id=${target.id} route=${target.route}`)

  const browser = await chromium.launch()
  let adminUserId
  try {
    // ---------- Admin context used purely to drive the PATCH via the real API ----------
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    adminUserId = await registerAndLogin(adminPage, 'admin', 'platform_admin')

    async function patchNavVisible(visible) {
      const res = await adminPage.evaluate(async ({ id, visible }) => {
        const r = await fetch(`/api/control-center/ecosystem-nav/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nav_visible: visible }),
        })
        return { status: r.status, body: await r.json() }
      }, { id: target.id, visible })
      assert.equal(res.status, 200, `PATCH nav_visible=${visible} expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
    }

    // ---------- DESKTOP: fresh, unauthenticated customer context (no admin session bleed) ----------
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const desktopPage = await desktopCtx.newPage()

    // 1. BEFORE HIDE (desktop)
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshPillDesktopBefore = desktopPage.locator('#ecosystem-nav-desktop a[href="/fresh"]')
    await assert_visible(freshPillDesktopBefore, 'desktop pill BEFORE hide')
    await desktopPage.screenshot({ path: `${OUT_DIR}/2a-desktop-01-before-hide.png`, fullPage: false })
    record('desktop-01-before-hide', 'PASS', 'Fresh pill visible in #ecosystem-nav-desktop, screenshot captured')

    // ---------- HIDE ----------
    await patchNavVisible(false)
    const dbAfterHide = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(dbAfterHide.nav_visible, 0, 'expected DB nav_visible=0 after hide')
    const cacheAfterHide = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.equal(cacheAfterHide, null, 'expected cache invalidated after hide')
    record('hide-db-and-cache', 'PASS', 'nav_visible=0 confirmed in DB, cache row invalidated')

    // 2. AFTER HIDE (desktop) — reload the REAL customer homepage
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshPillDesktopAfterHide = desktopPage.locator('#ecosystem-nav-desktop a[href="/fresh"]')
    await assert_hidden(freshPillDesktopAfterHide, 'desktop pill AFTER hide')
    await desktopPage.screenshot({ path: `${OUT_DIR}/2a-desktop-02-after-hide.png`, fullPage: false })
    record('desktop-02-after-hide', 'PASS', 'Fresh pill CONFIRMED ABSENT from #ecosystem-nav-desktop, screenshot captured')

    // ---------- RESTORE ----------
    await patchNavVisible(true)
    const dbAfterRestore = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(dbAfterRestore.nav_visible, 1, 'expected DB nav_visible=1 after restore')
    const cacheAfterRestore = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.equal(cacheAfterRestore, null, 'expected cache invalidated again after restore')
    record('restore-db-and-cache', 'PASS', 'nav_visible=1 confirmed in DB, cache row invalidated again')

    // 3. AFTER RESTORE (desktop)
    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshPillDesktopAfterRestore = desktopPage.locator('#ecosystem-nav-desktop a[href="/fresh"]')
    await assert_visible(freshPillDesktopAfterRestore, 'desktop pill AFTER restore')
    await desktopPage.screenshot({ path: `${OUT_DIR}/2a-desktop-03-after-restore.png`, fullPage: false })
    record('desktop-03-after-restore', 'PASS', 'Fresh pill CONFIRMED RESTORED in #ecosystem-nav-desktop, screenshot captured')
    await desktopCtx.close()

    // ---------- MOBILE: repeat the full hide/restore cycle independently ----------
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const mobilePage = await mobileCtx.newPage()

    // 1. BEFORE HIDE (mobile) — state is currently visible (we just restored it)
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshMobileBefore = mobilePage.locator('#ecosystem-nav-mobile-scroller a[href="/fresh"]')
    await assert_visible(freshMobileBefore, 'mobile scroller pill BEFORE hide')
    await mobilePage.screenshot({ path: `${OUT_DIR}/2a-mobile-01-before-hide.png`, fullPage: false })
    record('mobile-01-before-hide', 'PASS', 'Fresh visible in #ecosystem-nav-mobile-scroller, screenshot captured')

    // ---------- HIDE (again, for the mobile half of the proof) ----------
    await patchNavVisible(false)
    const dbAfterHide2 = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(dbAfterHide2.nav_visible, 0, 'expected DB nav_visible=0 after 2nd hide (mobile pass)')

    // 2. AFTER HIDE (mobile)
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshMobileAfterHide = mobilePage.locator('#ecosystem-nav-mobile-scroller a[href="/fresh"]')
    await assert_hidden(freshMobileAfterHide, 'mobile scroller pill AFTER hide')
    await mobilePage.screenshot({ path: `${OUT_DIR}/2a-mobile-02-after-hide.png`, fullPage: false })
    record('mobile-02-after-hide', 'PASS', 'Fresh CONFIRMED ABSENT from #ecosystem-nav-mobile-scroller, screenshot captured')

    // ---------- RESTORE (final, leaves DB in original state) ----------
    await patchNavVisible(true)
    const dbAfterRestore2 = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(dbAfterRestore2.nav_visible, 1, 'expected DB nav_visible=1 after final restore')

    // 3. AFTER RESTORE (mobile)
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' })
    const freshMobileAfterRestore = mobilePage.locator('#ecosystem-nav-mobile-scroller a[href="/fresh"]')
    await assert_visible(freshMobileAfterRestore, 'mobile scroller pill AFTER restore')
    await mobilePage.screenshot({ path: `${OUT_DIR}/2a-mobile-03-after-restore.png`, fullPage: false })
    record('mobile-03-after-restore', 'PASS', 'Fresh CONFIRMED RESTORED in #ecosystem-nav-mobile-scroller, screenshot captured')
    await mobileCtx.close()
  } finally {
    await browser.close()
    if (adminUserId) {
      await execD1(`DELETE FROM cc_user_roles WHERE user_id = ${adminUserId}`).catch(() => {})
    }
  }

  const failed = results.filter((r) => r.status !== 'PASS')
  console.log(`\n--- ${results.length - failed.length}/${results.length} PASS ---`)
  if (failed.length > 0) {
    console.error('FAILURES:', failed)
    process.exit(1)
  }
  console.log('=== ALL VISUAL QA CHECKS PASSED ===')
}

async function assert_visible(locator, label) {
  const count = await locator.count()
  assert.ok(count > 0, `expected ${label} to exist in the DOM`)
  const visible = await locator.first().isVisible()
  assert.ok(visible, `expected ${label} to be visible`)
}
async function assert_hidden(locator, label) {
  const count = await locator.count()
  assert.equal(count, 0, `expected ${label} to be absent from the DOM, but found ${count}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
