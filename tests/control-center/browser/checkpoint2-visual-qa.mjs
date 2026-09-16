/**
 * Checkpoint 2 — Playwright visual QA + customer-facing regression check.
 * Real Chromium, real running dev server (http://localhost:3000), real local D1.
 *
 * Captures:
 *  1. Desktop screenshot of the new /control-center/categories manager page
 *     (authenticated as platform_admin).
 *  2. Mobile screenshot of the same page (375x812 viewport).
 *  3. Desktop customer mega-menu: click "All Categories", confirm departments
 *     render, confirm at least one child category renders, screenshot.
 *  4. Mobile customer mega-menu: open drawer, open accordion, confirm it
 *     renders, screenshot.
 *
 * Run: node tests/control-center/browser/checkpoint2-visual-qa.mjs
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
  const email = `cctest_ckpt2visual_${label}_${RUN_NONCE}@test.ng`
  await page.goto(`${BASE_URL}/control-center/login`)
  const regRes = await page.evaluate(async ({ email, password, label }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Ckpt2 ${label}`, email, password }),
    })
    return { status: res.status, body: await res.json() }
  }, { email, password: PASSWORD, label })
  assert.equal(regRes.status, 200, `register failed: ${JSON.stringify(regRes.body)}`)
  const userId = regRes.body.user.id
  if (roleKey) {
    const roleRow = await queryOneD1(`SELECT id FROM cc_roles WHERE key = '${roleKey}'`)
    assert.ok(roleRow, `unknown cc_roles.key '${roleKey}'`)
    await execD1(`INSERT INTO cc_user_roles (user_id, role_id, assigned_by_user_id) VALUES (${userId}, ${roleRow.id}, ${userId})`)
  }
  await page.goto(`${BASE_URL}/control-center/login`)
  await page.fill('#cc-login-form input[name="identifier"]', email)
  await page.fill('#cc-login-form input[name="password"]', PASSWORD)
  await page.click('#cc-login-form button[type="submit"]')
  await page.waitForLoadState('networkidle')
  return { userId, email }
}

async function run() {
  const browser = await chromium.launch()

  // ---- 1 & 2: Category Manager CC page (desktop + mobile) ----
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await registerAndLogin(page, 'admin', 'platform_admin')
    await page.goto(`${BASE_URL}/control-center/categories`)
    await page.waitForSelector('#cat-cc-tree', { timeout: 8000 })
    await page.waitForTimeout(800) // let client JS render tree rows
    const rowCount = await page.locator('#cat-cc-tree > div').count()
    assert.ok(rowCount > 0, `expected category rows to render, got ${rowCount}`)
    await page.screenshot({ path: `${OUT_DIR}/checkpoint2-categories-desktop.png`, fullPage: true })
    record('DESKTOP screenshot — /control-center/categories renders hierarchy tree', 'PASS', `${rowCount} rows`)

    await context.close()
  } catch (err) {
    record('DESKTOP screenshot — /control-center/categories', 'FAIL', err.message)
  }

  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await registerAndLogin(page, 'adminmobile', 'platform_admin')
    await page.goto(`${BASE_URL}/control-center/categories`)
    await page.waitForSelector('#cat-cc-tree', { timeout: 8000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT_DIR}/checkpoint2-categories-mobile.png`, fullPage: true })
    record('MOBILE screenshot — /control-center/categories renders', 'PASS')
    await context.close()
  } catch (err) {
    record('MOBILE screenshot — /control-center/categories', 'FAIL', err.message)
  }

  // ---- 3: Desktop customer mega-menu regression ----
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/`)
    await page.click('#all-categories-btn')
    await page.waitForSelector('#mega-menu-panel:not(.hidden)', { timeout: 5000 })
    await page.waitForFunction(() => {
      const depts = document.getElementById('mega-menu-depts')
      return depts && depts.children.length > 0
    }, { timeout: 5000 })
    const deptCount = await page.locator('#mega-menu-depts button').count()
    assert.ok(deptCount > 0, 'expected department rail buttons')
    await page.waitForFunction(() => {
      const panels = document.getElementById('mega-menu-panels')
      return panels && panels.querySelectorAll('a').length > 0
    }, { timeout: 5000 })
    const childLinkCount = await page.locator('#mega-menu-panels a').count()
    assert.ok(childLinkCount > 0, 'expected child category links in active dept panel')
    await page.screenshot({ path: `${OUT_DIR}/checkpoint2-megamenu-desktop.png`, fullPage: false })
    record('DESKTOP regression — customer mega-menu opens, departments + children render', 'PASS', `${deptCount} depts, ${childLinkCount} links`)
    await context.close()
  } catch (err) {
    record('DESKTOP regression — customer mega-menu', 'FAIL', err.message)
  }

  // ---- 4: Mobile customer mega-menu accordion regression ----
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/`)
    await page.click('#mobile-menu-btn')
    await page.waitForSelector('#mobile-nav-drawer', { timeout: 5000 })
    await page.click('#mobile-all-categories-btn')
    await page.waitForFunction(() => {
      const list = document.getElementById('mobile-mega-menu-list')
      return list && !list.classList.contains('hidden') && list.querySelectorAll('details').length > 0
    }, { timeout: 5000 })
    const deptCount = await page.locator('#mobile-mega-menu-list details').count()
    assert.ok(deptCount > 0, 'expected accordion department entries')
    await page.screenshot({ path: `${OUT_DIR}/checkpoint2-megamenu-mobile.png`, fullPage: false })
    record('MOBILE regression — customer mega-menu accordion opens, departments render', 'PASS', `${deptCount} depts`)
    await context.close()
  } catch (err) {
    record('MOBILE regression — customer mega-menu accordion', 'FAIL', err.message)
  }

  await browser.close()

  console.log('\n========== CHECKPOINT 2 VISUAL QA SUMMARY ==========')
  let pass = 0, fail = 0
  for (const r of results) { if (r.status === 'PASS') pass++; else fail++ }
  console.log(`Totals: ${pass} PASS, ${fail} FAIL (of ${results.length})`)
  if (fail > 0) { console.error('\nRESULT: FAIL'); process.exitCode = 1 }
  else console.log('\nRESULT: All checks PASS.')
}

run().catch((err) => {
  console.error('FATAL:', err)
  process.exitCode = 1
})
