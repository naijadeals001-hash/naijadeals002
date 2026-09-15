// Enterprise Control Center V3 — screenshot capture matching Pat's exact
// 9 requested names. Real Chromium, real login, real data on every page.
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT_DIR = '/tmp/cc-preview-v3'
fs.mkdirSync(OUT_DIR, { recursive: true })

const CONSOLE_ERRORS = []

async function shoot(page, path, filename) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(400) // allow Chart.js render
  await page.screenshot({ path: `${OUT_DIR}/${filename}`, fullPage: true })
  console.log(`captured ${filename}`)
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') CONSOLE_ERRORS.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => CONSOLE_ERRORS.push(`[pageerror] ${err.message}`))

  // 01 — Enterprise Login
  await page.goto(`${BASE}/control-center/login`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT_DIR}/01-enterprise-login.png`, fullPage: true })
  console.log('captured 01-enterprise-login.png')

  // Log in as reviewer
  await page.fill('input[name="identifier"]', 'cc-reviewer@naijadeals.internal')
  await page.fill('input[name="password"]', 'ReviewGate2026!')
  await Promise.all([
    page.waitForURL('**/control-center*', { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1000)

  // 02 — Enterprise Command Center
  await shoot(page, '/control-center', '02-enterprise-command-center.png')
  // 03 — Africa Operations
  await shoot(page, '/control-center/africa', '03-africa-operations.png')
  // 04 — Nine-Vertical Ecosystem
  await shoot(page, '/control-center/ecosystem', '04-nine-vertical-ecosystem.png')
  // 05 — Operations Tower
  await shoot(page, '/control-center/operations', '05-operations-tower.png')
  // 06 — Verification
  await shoot(page, '/control-center/verification', '06-verification.png')
  // 07 — Finance
  await shoot(page, '/control-center/finance', '07-finance.png')
  // 08 — System Health
  await shoot(page, '/control-center/system-health', '08-system-health.png')
  // 09 — Audit & Governance
  await shoot(page, '/control-center/audit', '09-audit-governance.png')

  await browser.close()

  console.log('\n=== Console errors ===')
  if (CONSOLE_ERRORS.length === 0) {
    console.log('NONE — zero console errors across all pages.')
  } else {
    CONSOLE_ERRORS.forEach((e) => console.log(e))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
