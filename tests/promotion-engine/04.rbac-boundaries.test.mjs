/**
 * Promotion Engine — Engine 12 Legacy Remediation, Unit 4: RBAC boundary
 * regression coverage.
 *
 * PURPOSE: permanently encode the CURRENT REAL authorization boundary for
 * the three Engine 12 legacy systems (coupons, brand merchandising, hero
 * campaigns), as found by the Phase 0 audit and re-confirmed during this
 * remediation pass via repo-wide grep + live HTTP probing:
 *
 *   - Zero mutation routes exist anywhere in src/routes/ for coupons,
 *     brands, or hero_campaigns. `claimCouponUsage()` in src/lib/coupons.ts
 *     is the only "mutation" of any of these three tables outside
 *     seed.sql/migrations, and it is an INTERNAL function called only from
 *     inside createPendingOrder() during authenticated checkout -- never a
 *     directly-reachable HTTP endpoint of its own.
 *   - src/routes/api-admin.ts (the real, existing platform admin surface --
 *     moderation, collections, attributes, disputes, refunds, user status)
 *     is gated by `adminApi.use('*', requireAuth)` +
 *     `adminApi.use('*', requirePlatformRole('admin'))` and covers ZERO
 *     coupon/brand/hero-campaign routes.
 *
 * This suite does NOT invent fake admin endpoints to have something to
 * test. Per explicit instruction, "no mutation endpoint currently exists"
 * is itself the finding under test, and is asserted directly (Tests 5-7)
 * by proving the absence via real HTTP against the real running dev
 * server, not by static source inspection alone.
 *
 * Uses the SAME real-HTTP-against-the-running-dev-server methodology as
 * tests/identity-engine/helpers/client.mjs (ApiClient, registerUser,
 * promoteToAdmin) -- mirrored here rather than reinvented.
 *
 * PRECONDITION: the app must already be running locally (pm2 start
 * ecosystem.config.cjs -- wrangler pages dev dist --d1=... --local).
 *
 * Run via:
 *   npx tsx --test tests/promotion-engine/04.rbac-boundaries.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cleanupTestCoupons, disposeTestDb } from './helpers/db.mjs'

const execFileAsync = promisify(execFile)
const BASE_URL = process.env.PROMOTION_TEST_BASE_URL ?? 'http://localhost:3000'
const DB_BINDING = process.env.PROMOTION_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.PROMOTION_TEST_PROJECT_DIR ?? new URL('../../', import.meta.url).pathname
const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  return JSON.parse(stdout).map((s) => s.results)
}

class ApiClient {
  constructor() {
    this.cookies = new Map()
  }
  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  _captureCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const raw of setCookies) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  async request(method, path, { body } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookies.size > 0 ? { Cookie: this._cookieHeader() } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    this._captureCookies(res)
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = { __nonJsonBody: text } }
    return { status: res.status, body: json }
  }
  get(path) { return this.request('GET', path) }
  post(path, body) { return this.request('POST', path, { body }) }
}

async function registerUser(label) {
  const client = new ApiClient()
  const email = `promotest_rbac_${label}_${RUN_NONCE}@test.ng`
  const res = await client.post('/api/auth/register', { name: `RBAC Harness ${label}`, email, password: 'TestPass123!' })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  return { client, userId: res.body.user.id, email }
}

async function promoteToAdmin(userId) {
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${Number(userId)}`)
}

let createdUserIds = []

test.after(async () => {
  await cleanupTestCoupons()
  if (createdUserIds.length > 0) {
    await execD1(`DELETE FROM sessions WHERE user_id IN (${createdUserIds.join(',')});`)
    await execD1(`DELETE FROM users WHERE id IN (${createdUserIds.join(',')});`)
  }
  await disposeTestDb()
})

// ---------- 1. Existing admin API remains protected: unauthenticated ----------
test('existing admin API: unauthenticated request to a real admin mutation route is rejected (401)', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/admin/collections', { name: 'x', slug: `promotest-rbac-${RUN_NONCE}` })
  assert.equal(res.status, 401)
  assert.match(res.body.error, /authentication/i)
})

// ---------- 2. Existing admin API remains protected: authenticated but non-admin ----------
test('existing admin API: authenticated non-admin user is rejected from a real admin mutation route (403)', async () => {
  const { client, userId } = await registerUser('nonadmin')
  createdUserIds.push(userId)
  const res = await client.post('/api/admin/collections', { name: 'x', slug: `promotest-rbac-${RUN_NONCE}` })
  assert.equal(res.status, 403)
  assert.match(res.body.error, /permission/i)
})

// ---------- 3. Existing admin API remains protected: authenticated admin succeeds ----------
test('existing admin API: authenticated admin user IS authorized on a real admin mutation route (not 401/403)', async () => {
  const { client, userId } = await registerUser('admin')
  createdUserIds.push(userId)
  await promoteToAdmin(userId)
  const res = await client.post('/api/admin/collections', { name: 'RBAC Test Collection', slug: `promotest-rbac-${RUN_NONCE}` })
  assert.notEqual(res.status, 401)
  assert.notEqual(res.status, 403)
  // Clean up the collection this test created (not part of the shared user cleanup).
  if (res.body?.id) {
    await execD1(`DELETE FROM collections WHERE id = ${Number(res.body.id)};`)
  }
})

// ---------- 4. Public catalog reads remain public (no auth required) ----------
test('public catalog read: GET /api/catalog/products?brand=... requires no authentication', async () => {
  const anon = new ApiClient()
  const res = await anon.get('/api/catalog/products?brand=apple')
  assert.equal(res.status, 200)
})

// ---------- 5. Public homepage (hero campaigns + brands) remains public ----------
test('public homepage read: GET / (renders hero campaigns + top brands) requires no authentication', async () => {
  const anon = new ApiClient()
  const res = await fetch(`${BASE_URL}/`)
  assert.equal(res.status, 200)
})

// ---------- 6. No coupon/brand/hero-campaign ADMIN mutation route exists anywhere ----------
test('absence finding: no dedicated admin mutation route exists for coupons, brands, or hero_campaigns', async () => {
  const { client, userId } = await registerUser('admin-probe')
  createdUserIds.push(userId)
  await promoteToAdmin(userId)

  const probePaths = [
    '/api/admin/coupons', '/api/admin/coupons/1',
    '/api/admin/brands', '/api/admin/brands/1',
    '/api/admin/hero-campaigns', '/api/admin/hero-campaigns/1',
    '/api/coupons', '/api/brands', '/api/hero-campaigns'
  ]
  for (const path of probePaths) {
    const res = await client.post(path, { probe: true })
    // A real mutation route would respond 200/201/400/422 (route exists, validates
    // input). A route that does not exist falls through Hono's router to a 404.
    // Some frameworks return 401/403 at a catch-all layer, but this admin client
    // is already authenticated+authorized, so if any of these ever start
    // returning anything OTHER than 404, that is a newly-added mutation surface
    // that MUST get its own dedicated RBAC test in the same change that adds it.
    assert.equal(res.status, 404, `expected ${path} to not exist (404), got ${res.status} -- a new mutation route was added without RBAC test coverage`)
  }
})

// ---------- 7. Coupon usage can only occur through the authenticated checkout/order flow ----------
test('coupon usage boundary: claimCouponUsage() is not reachable via any standalone HTTP endpoint; it is only invoked internally by createPendingOrder()', async () => {
  // Static/structural proof: grep the real route files for any direct HTTP
  // handler calling claimCouponUsage() outside of src/lib/orders.ts itself.
  const { stdout } = await execFileAsync('grep', ['-rl', 'claimCouponUsage', PROJECT_DIR + 'src/'], { maxBuffer: 1024 * 1024 }).catch((e) => ({ stdout: e.stdout ?? '' }))
  const filesReferencingIt = stdout.trim().split('\n').filter(Boolean).map((f) => f.replace(PROJECT_DIR, ''))
  assert.deepEqual(
    filesReferencingIt.sort(),
    ['src/lib/coupons.ts', 'src/lib/orders.ts'].sort(),
    'claimCouponUsage() must only be defined in coupons.ts and called from orders.ts -- any additional caller is a new, untested mutation surface'
  )
})

// ---------- 8. Client-supplied identity cannot bypass RBAC (ownership/role forgery attempt) ----------
test('no client-supplied identity bypass: a non-admin cannot self-declare admin via request body/headers on a real admin route', async () => {
  const { client, userId } = await registerUser('forge-attempt')
  createdUserIds.push(userId)

  // Attempt to forge admin identity via a spoofed header and a spoofed body field --
  // the real requirePlatformRole('admin') middleware reads ONLY the server-resolved
  // session user (c.get('user').role from the DB), never client-supplied claims.
  const res = await fetch(`${BASE_URL}/api/admin/collections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: client._cookieHeader(),
      'X-User-Role': 'admin',
      'X-Admin': 'true'
    },
    body: JSON.stringify({ name: 'forged', slug: `promotest-forge-${RUN_NONCE}`, role: 'admin', is_admin: true })
  })
  assert.equal(res.status, 403, 'a non-admin user must remain forbidden regardless of spoofed headers/body claims')
})
