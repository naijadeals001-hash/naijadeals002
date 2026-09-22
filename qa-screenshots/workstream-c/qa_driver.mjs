/**
 * Workstream C — Responsive + Functional QA driver.
 * READ-ONLY against the running dev server. Makes zero changes to
 * application code, database schema, or git state. Uses Playwright to
 * drive the real browser against http://localhost:3000, capturing
 * screenshots + console/network errors + DOM assertions at 6 viewports
 * for /gigs, /stay, /aura, /ecosystem, plus deep functional flows.
 *
 * Usage: node qa-screenshots/workstream-c/qa_driver.mjs <phase>
 *   phase: responsive | gigs | stay | aura | ecosystem | all
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT_DIR = '/home/user/webapp/qa-screenshots/workstream-c'
const VIEWPORTS = [
  { name: '1440-desktop', width: 1440, height: 900 },
  { name: '1280-desktop', width: 1280, height: 800 },
  { name: '1024-tablet', width: 1024, height: 900 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '390-mobile', width: 390, height: 844 },
  { name: '375-mobile', width: 375, height: 812 },
]
const ROUTES = ['/gigs', '/stay', '/aura', '/ecosystem']

const results = []
function record(entry) {
  results.push(entry)
  console.log(`[${entry.status}] ${entry.route || ''} ${entry.viewport || ''} :: ${entry.check}`)
  if (entry.status !== 'PASS') {
    console.log(`    expected: ${entry.expected}`)
    console.log(`    actual:   ${entry.actual}`)
    if (entry.evidence) console.log(`    evidence: ${entry.evidence}`)
  }
}

async function withPage(browser, viewport, cookies, fn) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  if (cookies) await context.addCookies(cookies)
  const page = await context.newPage()
  const consoleErrors = []
  const networkErrors = []
  const unauthorizedUrls = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
  page.on('response', (res) => {
    if (res.status() >= 500) networkErrors.push(`${res.status()} ${res.url()}`)
    if (res.status() === 401) unauthorizedUrls.push(res.url())
  })
  try {
    await fn(page, consoleErrors, networkErrors, unauthorizedUrls)
  } finally {
    await context.close()
  }
}

async function phaseResponsive(browser) {
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      await withPage(browser, vp, null, async (page, consoleErrors, networkErrors, unauthorizedUrls) => {
        const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => ({ __err: e }))
        if (resp && resp.__err) {
          record({ status: 'BLOCKED', route, viewport: vp.name, check: 'page load', expected: '200 OK', actual: `navigation error: ${resp.__err.message}` })
          return
        }
        const status = resp.status()
        const shotPath = path.join(OUT_DIR, `${route.replace(/\//g, '_')}_${vp.name}.png`)
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {})
        if (status !== 200) {
          record({ status: 'BUSINESS/ASSERTION FAILURE', route, viewport: vp.name, check: 'HTTP status', expected: '200', actual: String(status), evidence: shotPath })
          return
        }
        // Check for horizontal overflow (layout breakage)
        const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5)
        // Check for stale demo/coming-soon labels. Excludes the known,
        // legitimate site-wide "Get the app (coming soon)" footer link
        // (present on every page including the homepage, unrelated to any
        // ecosystem vertical's status) — verified via direct inspection.
        const bodyText = await page.evaluate(() => document.body.innerText)
        const bodyTextSansFooterApp = bodyText.replace(/Get the app \(coming soon\)/gi, '')
        const staleMarkers = ['[DEMO]', 'Coming Soon', 'coming soon', 'Demo Mode', 'demo mode', 'not connected']
        const foundStale = staleMarkers.filter((m) => bodyTextSansFooterApp.includes(m))
        if (hasOverflow) {
          record({ status: 'BUSINESS/ASSERTION FAILURE', route, viewport: vp.name, check: 'no horizontal overflow', expected: 'scrollWidth <= clientWidth', actual: 'horizontal overflow detected', evidence: shotPath })
        } else {
          record({ status: 'PASS', route, viewport: vp.name, check: 'no horizontal overflow' })
        }
        if (foundStale.length > 0) {
          if (route === '/ecosystem' && foundStale.every((f) => f.toLowerCase() === 'coming soon')) {
            // /ecosystem legitimately shows "Coming soon" badges for the
            // still-non-live verticals (fresh/eats/drive/send/stream) —
            // that is correct, expected content, not a stale label.
            record({ status: 'PASS', route, viewport: vp.name, check: 'stale label scan (coming-soon badges expected for non-live verticals: fresh/eats/drive/send/stream)' })
          } else {
            record({ status: 'BUSINESS/ASSERTION FAILURE', route, viewport: vp.name, check: 'no stale demo/coming-soon labels', expected: 'none of ' + staleMarkers.join(','), actual: `found: ${foundStale.join(', ')}`, evidence: shotPath })
          }
        } else {
          record({ status: 'PASS', route, viewport: vp.name, check: 'no stale demo/coming-soon labels' })
        }
        // Known, verified-benign guest-session 401s (identical on the
        // homepage and every other page site-wide — /api/wallet and
        // /api/wishlist/ids gracefully degrade for logged-out visitors by
        // design; see public/static/app.js). Playwright's console.error
        // text doesn't include the failing URL, so we correlate by COUNT:
        // if every 401-shaped console error is accounted for by a known-
        // benign 401 network response on this exact page load, treat as
        // expected; only flag the excess as real.
        const knownBenign401Count = unauthorizedUrls.filter(
          (u) => u.includes('/api/wallet') || u.includes('/api/wishlist/ids')
        ).length
        const unauthorizedConsoleErrors = consoleErrors.filter((e) => e.includes('401'))
        const otherConsoleErrors = consoleErrors.filter((e) => !e.includes('401'))
        const unexplained401s = Math.max(0, unauthorizedConsoleErrors.length - knownBenign401Count)
        const realConsoleErrors = [...otherConsoleErrors, ...(unexplained401s > 0 ? [`${unexplained401s} unexplained 401 console error(s)`] : [])]
        if (realConsoleErrors.length > 0) {
          record({ status: 'BUSINESS/ASSERTION FAILURE', route, viewport: vp.name, check: 'no console errors', expected: '0 unexpected console errors', actual: realConsoleErrors.join(' | ').slice(0, 500) })
        } else {
          record({ status: 'PASS', route, viewport: vp.name, check: 'no console errors (excluding known-benign guest 401s on /api/wallet, /api/wishlist/ids)' })
        }
        if (networkErrors.length > 0) {
          record({ status: 'INFRASTRUCTURE FAILURE', route, viewport: vp.name, check: 'no 5xx network errors', expected: '0 5xx responses', actual: networkErrors.join(' | ') })
        } else {
          record({ status: 'PASS', route, viewport: vp.name, check: 'no 5xx network errors' })
        }
      })
    }
  }
}

async function main() {
  const phase = process.argv[2] || 'responsive'
  const browser = await chromium.launch()
  if (phase === 'responsive' || phase === 'all') {
    await phaseResponsive(browser)
  }
  await browser.close()

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    business: results.filter((r) => r.status === 'BUSINESS/ASSERTION FAILURE').length,
    infra: results.filter((r) => r.status === 'INFRASTRUCTURE FAILURE').length,
    fixture: results.filter((r) => r.status === 'TEST-FIXTURE/ENVIRONMENT DEFECT').length,
    blocked: results.filter((r) => r.status === 'BLOCKED').length,
  }
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(OUT_DIR, `results_${phase}.json`), JSON.stringify(results, null, 2))
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
