// Enterprise Control Center V4 refinement pass — captures ONLY the 3 critical
// screens Pat asked for (Command Center, Africa Operations, Ecosystem) to
// avoid wasting build budget on a full 9-screenshot pass before direction is
// re-confirmed. Real Chromium, real login, real data on every page.
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT_DIR = '/tmp/cc-preview-v4'
fs.mkdirSync(OUT_DIR, { recursive: true })

const CONSOLE_ERRORS = []

async function shoot(page, path, filename) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500) // allow Chart.js render
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

  await page.goto(`${BASE}/control-center/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="identifier"]', 'cc-reviewer@naijadeals.internal')
  await page.fill('input[name="password"]', 'ReviewGate2026!')
  await Promise.all([
    page.waitForURL('**/control-center*', { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1000)

  // 1 — Command Center
  await shoot(page, '/control-center', '01-command-center.png')
  // 2 — Africa Operations
  await shoot(page, '/control-center/africa', '02-africa-operations.png')
  // 3 — Ecosystem
  await shoot(page, '/control-center/ecosystem', '03-ecosystem.png')

  await browser.close()

  console.log('\n=== Console errors ===')
  if (CONSOLE_ERRORS.length === 0) {
    console.log('NONE — zero console errors across all 3 pages.')
  } else {
    CONSOLE_ERRORS.forEach((e) => console.log(e))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
