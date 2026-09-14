/**
 * Enterprise Control Center — Phase 1, Step 13: ACTUAL CHROMIUM/PLAYWRIGHT
 * VERIFICATION.
 *
 * Mirrors tests/identity-engine/browser/engine1-browser-journeys.mjs's
 * methodology EXACTLY: a REAL Chromium browser (the `playwright` package,
 * already installed as a project devDependency, chromium-1234 already
 * downloaded in this sandbox) drives the REAL running dev server
 * (http://localhost:3000). No curl, no API-only shortcuts stand in for a
 * browser assertion below — every PASS is produced by an actual page
 * navigating, filling a form, clicking a button, and asserting on the
 * resulting DOM/URL/cookie state. Where a step is genuinely API-driven
 * (there is no dedicated UI control for it), it is executed via
 * page.evaluate() so it still runs inside the real browser's JS engine
 * against the real running server — exactly the identity-engine
 * precedent's own documented pattern for its own UI gaps.
 *
 * PRECONDITION: the app must already be running locally with a local D1
 * binding (pm2 start ecosystem.config.cjs). This script does NOT start
 * the server itself.
 *
 * Run with:
 *   node tests/control-center/browser/cc-browser-journeys.mjs
 */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DB_BINDING = process.env.CC_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.CC_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  return parsed.map((stmt) => stmt.results)
}
async function queryOneD1(sql) {
  const results = await execD1(sql)
  const rows = results[results.length - 1]
  return rows[0] ?? null
}

const BASE_URL = process.env.CC_TEST_BASE_URL ?? 'http://localhost:3000'
const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`
const PASSWORD = 'TestPass123!'
let nextSeq = 0
function freshEmail(label) {
  nextSeq += 1
  return `ccbrowsertest_${label}_${RUN_NONCE}_${nextSeq}@test.ng`
}

const results = []
function record(journey, status, detail) {
  results.push({ journey, status, detail })
  console.log(`[${status}] ${journey}${detail ? ' — ' + detail : ''}`)
}

/** Registers a real user via the real /register page in the given page's browser context, returns {email, userId}. */
async function registerRealUser(page, label) {
  const email = freshEmail(label)
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'load' })
  await page.fill('input[name="name"]', `CC Browser Test ${label}`)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('#register-form button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/`, { timeout: 8000 })
  const row = await queryOneD1(`SELECT id FROM users WHERE email='${email}'`)
  return { email, userId: row.id }
}

async function grantRole(userId, roleKey) {
  const role = await queryOneD1(`SELECT id FROM cc_roles WHERE key='${roleKey}'`)
  await execD1(`INSERT INTO cc_user_roles (user_id, role_id, assigned_by_user_id) VALUES (${userId}, ${role.id}, ${userId})`)
}

async function createPendingVendor(label) {
  const { userId: ownerUserId } = await (async () => {
    // A throwaway browser-independent user is fine for the OWNED vendor row itself —
    // this fixture's own creation is not part of what Journey D verifies (the
    // verification DECISION is); it just needs to be a real, pending row.
    const row = await queryOneD1(
      `INSERT INTO users (name, email, password_hash, password_salt, role, status) VALUES ('CC Fixture Owner', 'ccbrowserowner_${label}_${RUN_NONCE}@test.ng', 'x', 'x', 'customer', 'active') RETURNING id`
    )
    return { userId: row.id }
  })()
  const slug = `ccbrowsertest-vendor-${label}-${RUN_NONCE}`
  const row = await queryOneD1(
    `INSERT INTO vendors (slug, name, business_name, business_email, city, state, verification_status, store_status, user_id)
     VALUES ('${slug}', '${slug}', '${slug} Ltd', '${slug}@test.ng', 'Lagos', 'Lagos', 'pending', 'active', ${ownerUserId})
     RETURNING id, slug`
  )
  return row
}

async function run() {
  // Pre-run hygiene: clear the shared 127.0.0.1 login_attempts IP axis the
  // identity-engine browser journeys already document as necessary in this
  // sandbox (local wrangler dev reports every request from the same IP).
  await execD1(`DELETE FROM login_attempts WHERE ip_address = '127.0.0.1'`).catch(() => {})

  const browser = await chromium.launch({ headless: true })

  try {
    // ================================================================
    // JOURNEY A — unauthenticated
    // ================================================================
    {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'load' })
        assert.ok(
          page.url().startsWith(`${BASE_URL}/control-center/login`),
          `expected an unauthenticated browser visit to /control-center to redirect to the login page, got ${page.url()}`
        )
        await page.waitForSelector('#cc-login-form', { timeout: 5000 })
        record('Journey A — unauthenticated', 'PASS', `real browser navigation to /control-center redirected to ${page.url()}, real #cc-login-form rendered`)
      } catch (err) {
        record('Journey A — unauthenticated', 'FAIL', err.message)
      } finally {
        await context.close()
      }
    }

    // ================================================================
    // JOURNEY B — login (real test Control Center administrator)
    // ================================================================
    let adminContext = null
    let adminEmail = null
    let adminUserId = null
    {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        const { email, userId } = await registerRealUser(page, 'admin')
        adminEmail = email
        adminUserId = userId
        await grantRole(userId, 'platform_admin')

        // Registration auto-logged the browser into the REGULAR site
        // session; a real Control Center login must still be performed
        // explicitly via the real CC login form (Section 5: same session
        // cookie, but the CC login route independently re-verifies CC
        // authorization every time — it is not "already signed in
        // elsewhere" shortcutting anything).
        await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }) })

        await page.goto(`${BASE_URL}/control-center/login`, { waitUntil: 'load' })
        await page.fill('input[name="identifier"]', email)
        await page.fill('input[name="password"]', PASSWORD)
        await page.click('#cc-login-form button[type="submit"]')
        await page.waitForURL(`${BASE_URL}/control-center`, { timeout: 8000 })

        const cookies = await context.cookies()
        assert.ok(cookies.find((c) => c.name === 'nd_session'), 'expected nd_session cookie to be set after a real Control Center login')

        await page.waitForSelector('text=Platform Overview', { timeout: 5000 })
        const bodyText = await page.textContent('body')
        assert.ok(bodyText.includes('Customers'), 'expected the real dashboard stat cards to render')
        assert.ok(bodyText.includes('Control Center'), 'expected the real Control Center shell (header) to render')

        record('Journey B — login', 'PASS', 'real form submit on the real CC login page succeeded, redirected to /control-center, real dashboard UI (Platform Overview + stat cards) rendered')
        adminContext = context
      } catch (err) {
        record('Journey B — login', 'FAIL', err.message)
        await context.close()
      }
    }

    // ================================================================
    // JOURNEY C — unauthorized account
    // ================================================================
    {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        const { email } = await registerRealUser(page, 'unauth')
        // Deliberately grant ZERO Control Center roles — this is a genuine
        // NaijaDeals customer with no cc_user_roles row at all.
        await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }) })

        await page.goto(`${BASE_URL}/control-center/login`, { waitUntil: 'load' })
        await page.fill('input[name="identifier"]', email)
        await page.fill('input[name="password"]', PASSWORD)
        await page.click('#cc-login-form button[type="submit"]')

        // The real inline JS shows an error and does NOT navigate away.
        await page.waitForSelector('#cc-auth-error:not(.hidden)', { timeout: 5000 })
        const errorText = await page.textContent('#cc-auth-error')
        assert.match(errorText, /do not have Control Center access/i)
        assert.ok(page.url().startsWith(`${BASE_URL}/control-center/login`), 'expected to remain on the login page after a denied CC login attempt')

        // Confirm directly navigating to the dashboard is also denied for this account.
        await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'load' })
        assert.ok(page.url().startsWith(`${BASE_URL}/control-center/login`), 'expected the dashboard to still redirect to login for this unauthorized account')

        record('Journey C — unauthorized account', 'PASS', 'real browser login attempt with valid credentials but zero cc_user_roles was denied with the correct on-page error message, and direct dashboard navigation was also redirected')
      } catch (err) {
        record('Journey C — unauthorized account', 'FAIL', err.message)
      } finally {
        await context.close()
      }
    }

    // ================================================================
    // JOURNEY D — verification (real decision, real UI update, real DB
    // state change, real audit event)
    // ================================================================
    if (adminContext) {
      const page = await adminContext.newPage()
      try {
        const vendor = await createPendingVendor('journeyD')

        await page.goto(`${BASE_URL}/control-center/vendors`, { waitUntil: 'load' })
        await page.waitForSelector('#cc-vendor-table', { timeout: 5000 })
        const rowLocator = page.locator(`tr[data-vendor-id="${vendor.id}"]`)
        await assert.doesNotReject(rowLocator.waitFor({ timeout: 5000 }), 'expected the real pending vendor to appear as a real table row in the real queue page')

        // Click the REAL Approve button (this triggers the SAME inline
        // fetch() to /api/control-center/verifications/vendors/:id/decision
        // the Step 12 HTTP suite exercises directly — here it is triggered
        // by an actual click event inside the real browser).
        await rowLocator.locator('button[data-decision="verify"]').click()

        // The real inline JS does `location.reload()` on success — wait for
        // the row to disappear from the reloaded, real server-rendered page.
        await page.waitForFunction(
          (vendorId) => !document.querySelector(`tr[data-vendor-id="${vendorId}"]`),
          vendor.id,
          { timeout: 8000 }
        )

        // Real underlying DB state change, read independently of the page.
        const dbRow = await queryOneD1(`SELECT verification_status FROM vendors WHERE id=${vendor.id}`)
        assert.equal(dbRow.verification_status, 'verified', 'expected the real vendors row to be updated to verified after the real browser click')

        // Real audit event, read independently of the page.
        const auditRow = await queryOneD1(
          `SELECT actor_user_id, success FROM cc_audit_logs WHERE action='vendor_verification_decision' AND entity_id='${vendor.id}' ORDER BY id DESC LIMIT 1`
        )
        assert.ok(auditRow, 'expected a real cc_audit_logs row for this exact browser-driven decision')
        assert.equal(Number(auditRow.actor_user_id), adminUserId, 'expected the audit row to attribute the action to the real logged-in browser session\'s user')
        assert.equal(Number(auditRow.success), 1)

        record(
          'Journey D — verification',
          'PASS',
          `real click on the Approve button in /control-center/vendors: request succeeded, UI updated (row removed from queue on reload), underlying vendors.verification_status changed to 'verified' in D1, and a real cc_audit_logs row (actor=${adminUserId}, success=1) exists`
        )
      } catch (err) {
        record('Journey D — verification', 'FAIL', err.message)
      } finally {
        await page.close()
      }
    } else {
      record('Journey D — verification', 'BLOCKED', 'Journey B did not produce a usable authenticated admin context')
    }

    // ---- Journey D (negative half) — an authorized-but-under-permissioned CC user's Approve button is genuinely absent, not just visually hidden by CSS ----
    {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        const { email, userId } = await registerRealUser(page, 'readonly')
        await grantRole(userId, 'auditor') // real cc role, but zero *.verify/*.manage permissions
        await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }) })

        await page.goto(`${BASE_URL}/control-center/login`, { waitUntil: 'load' })
        await page.fill('input[name="identifier"]', email)
        await page.fill('input[name="password"]', PASSWORD)
        await page.click('#cc-login-form button[type="submit"]')
        await page.waitForURL(`${BASE_URL}/control-center`, { timeout: 8000 })

        await page.goto(`${BASE_URL}/control-center/vendors`, { waitUntil: 'load' })
        const approveButtonCount = await page.locator('button[data-decision="verify"]').count()
        assert.equal(approveButtonCount, 0, 'expected the auditor role (no vendors.verify) to see ZERO Approve buttons in the DOM — not present, not merely hidden')

        record('Journey D (negative) — read-only role sees no Approve control', 'PASS', 'a real auditor-role browser session rendered the real vendor queue page with zero Approve buttons present in the DOM')
      } catch (err) {
        record('Journey D (negative) — read-only role sees no Approve control', 'FAIL', err.message)
      } finally {
        await context.close()
      }
    }

    // ================================================================
    // JOURNEY E — logout, then attempt to revisit the protected Control Center
    // ================================================================
    if (adminContext) {
      const page = await adminContext.newPage()
      try {
        await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'load' })
        assert.equal(page.url(), `${BASE_URL}/control-center`, 'precondition: the admin session must still be valid before logout')

        // Click the REAL sign-out button (a real <form method="post"> submit, not a fetch shortcut).
        await page.click('#cc-header form[action="/control-center/logout"] button[type="submit"]')
        await page.waitForURL(`${BASE_URL}/control-center/login`, { timeout: 8000 })

        // Revisit the protected dashboard with the SAME browser context/cookie jar.
        await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'load' })
        assert.ok(page.url().startsWith(`${BASE_URL}/control-center/login`), `expected the dashboard to redirect to login after logout, got ${page.url()}`)

        record('Journey E — logout', 'PASS', 'real click on the real sign-out button redirected to the login page; revisiting /control-center with the same browser context was denied/redirected, confirming server-side session invalidation')
      } catch (err) {
        record('Journey E — logout', 'FAIL', err.message)
      } finally {
        await page.close()
        await adminContext.close()
      }
    } else {
      record('Journey E — logout', 'BLOCKED', 'Journey B did not produce a usable authenticated admin context')
    }
  } finally {
    await browser.close()
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log('\n========== ENTERPRISE CONTROL CENTER BROWSER JOURNEY SUMMARY ==========')
  let passCount = 0, failCount = 0, blockedCount = 0, notRunCount = 0
  for (const r of results) {
    console.log(`${r.status.padEnd(10)} ${r.journey}`)
    if (r.status === 'PASS') passCount++
    else if (r.status === 'FAIL') failCount++
    else if (r.status === 'BLOCKED') blockedCount++
    else notRunCount++
  }
  console.log(`\nTotals: ${passCount} PASS, ${failCount} FAIL, ${blockedCount} BLOCKED, ${notRunCount} NOT RUN (of ${results.length})`)

  if (failCount > 0 || blockedCount > 0) {
    console.error('\nRESULT: FAIL — one or more browser journeys failed or were blocked.')
    process.exitCode = 1
  } else {
    console.log('\nRESULT: All browser journeys PASS.')
  }
}

run().catch((err) => {
  console.error('FATAL — browser journey runner crashed:', err)
  process.exitCode = 1
})
