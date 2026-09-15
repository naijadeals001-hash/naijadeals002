import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE_URL = process.env.CC_BASE_URL ?? 'http://localhost:3000'
const DIR = '/tmp/cc-preview-v2'
fs.mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

// 1. Login page
await page.goto(`${BASE_URL}/control-center/login`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/01-login.png`, fullPage: true })
console.log('01-login captured')

// 2. Log in
await page.fill('input[name="identifier"]', 'cc-reviewer@naijadeals.internal')
await page.fill('input[name="password"]', 'ReviewGate2026!')
await page.click('button[type="submit"]')
await page.waitForURL('**/control-center', { timeout: 10000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${DIR}/02-command-center.png`, fullPage: true })
console.log('02-command-center captured')

// 3. Ecosystem
await page.goto(`${BASE_URL}/control-center/ecosystem`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/03-ecosystem.png`, fullPage: true })
console.log('03-ecosystem captured')

// 4. System Health
await page.goto(`${BASE_URL}/control-center/system-health`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/04-system-health.png`, fullPage: true })
console.log('04-system-health captured')

// 5. Finance
await page.goto(`${BASE_URL}/control-center/finance`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/05-finance.png`, fullPage: true })
console.log('05-finance captured')

// 6. Aura
await page.goto(`${BASE_URL}/control-center/aura`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/06-aura.png`, fullPage: true })
console.log('06-aura captured')

// 7. Countries
await page.goto(`${BASE_URL}/control-center/countries`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/07-countries.png`, fullPage: true })
console.log('07-countries captured')

// 8. Vendors
await page.goto(`${BASE_URL}/control-center/vendors`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/08-vendors.png`, fullPage: true })
console.log('08-vendors captured')

// 9. Audit
await page.goto(`${BASE_URL}/control-center/audit`, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${DIR}/09-audit.png`, fullPage: true })
console.log('09-audit captured')

// 10. Test global search actually works
await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'networkidle' })
await page.fill('#cc-search-input', 'cc-reviewer')
await page.waitForTimeout(600)
await page.screenshot({ path: `${DIR}/10-search-live.png`, fullPage: false })
console.log('10-search-live captured')

console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE')

await browser.close()
