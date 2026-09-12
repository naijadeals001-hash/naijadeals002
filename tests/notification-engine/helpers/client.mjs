/**
 * Notification Engine (Engine 9) — permanent regression harness, HTTP test
 * client. Mirrors tests/booking-engine/helpers/client.mjs exactly (same
 * repo, same author intent, same black-box-HTTP-against-the-real-running-
 * dev-server methodology) — deliberately not reinvented.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BASE_URL = process.env.NOTIF_TEST_BASE_URL ?? 'http://localhost:3000'
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

const DB_BINDING = process.env.NOTIF_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.NOTIF_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

export async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  return parsed.map((stmt) => stmt.results)
}

export async function queryD1(sql) {
  const results = await execD1(sql)
  return results[results.length - 1]
}

export async function queryOneD1(sql) {
  const rows = await queryD1(sql)
  return rows[0] ?? null
}

export class ApiClient {
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
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      this.cookies.set(name, value)
    }
  }

  async request(method, path, { body, headers = {} } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookies.size > 0 ? { Cookie: this._cookieHeader() } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    })
    this._captureCookies(res)
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, body: json, rawText: text }
  }

  get(path, opts) {
    return this.request('GET', path, opts)
  }
  post(path, body, opts) {
    return this.request('POST', path, { ...opts, body })
  }
  put(path, body, opts) {
    return this.request('PUT', path, { ...opts, body })
  }
  delete(path, opts) {
    return this.request('DELETE', path, opts)
  }
}

/** Registers a brand-new user via the real HTTP endpoint (never a direct DB insert bypassing app logic) — returns an authenticated client + userId + email. */
export async function registerUser(label) {
  const client = new ApiClient()
  const email = `nftest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const res = await client.post('/api/auth/register', {
    name: `NotifHarness ${label}`,
    email,
    password: 'TestPass123!',
  })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.user?.id, `registerUser(${label}) did not return a user id`)
  return { client, userId: res.body.user.id, email }
}

/** Promotes a user to platform role 'admin' directly via D1 (there is no public self-service "become admin" endpoint by design — mirrors booking-engine's creditWalletDirect's rationale for bypassing the app for a role only an existing admin/ops process would ever set). */
export async function promoteToAdmin(userId) {
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${Number(userId)}`)
}

/** Creates a minimal paid order for a fresh customer + vendor, returning orderId/orderItemId — reuses real seed category/vendor rows exactly like tests/payment-engine/helpers/order-fixtures.mjs, but through the real HTTP checkout flow (payment_method: 'wallet', pre-funded wallet) rather than a fabricated endpoint, so the ACTUAL order-lifecycle/notification event writer path is exercised. */
export async function createAndPayOrder(client, userId, { priceKobo = 500000 } = {}) {
  const catalogRow = await queryOneD1(`SELECT id FROM categories LIMIT 1`)
  const vendorRow = await queryOneD1(`SELECT id FROM vendors LIMIT 1`)
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
  await execD1(
    `INSERT INTO products (slug, category_id, title, image_url) VALUES ('nftest-prod-${nonce}', ${catalogRow.id}, 'Notif Test Product ${nonce}', '/static/ph.svg')`
  )
  const productIdRow = await queryOneD1(`SELECT id FROM products WHERE slug = 'nftest-prod-${nonce}'`)
  await execD1(
    `INSERT INTO product_listings (product_id, vendor_id, price_kobo, stock) VALUES (${productIdRow.id}, ${vendorRow.id}, ${priceKobo}, 1000)`
  )
  const listingRow = await queryOneD1(`SELECT id FROM product_listings WHERE product_id = ${productIdRow.id}`)

  // Pre-fund the wallet directly (mirrors booking-engine's
  // creditWalletDirect rationale — there is no public self-service "top
  // up for free" endpoint) so checkout's wallet payment path succeeds in
  // one call.
  await execD1(
    `INSERT INTO wallet_accounts (user_id, cached_balance_kobo) VALUES (${userId}, ${priceKobo * 3})
     ON CONFLICT(user_id) DO UPDATE SET cached_balance_kobo = ${priceKobo * 3}`
  )

  const orderRes = await client.post('/api/orders/checkout', {
    buy_now: { listing_id: listingRow.id, quantity: 1 },
    name: 'Notif Test', phone: '08011111111', address: '1 Test Rd', city: 'Lagos', state: 'Lagos',
    delivery_method: 'standard',
    payment_method: 'wallet',
  })
  assert.equal(orderRes.status, 200, `checkout failed: ${JSON.stringify(orderRes.body)}`)
  assert.equal(orderRes.body.paid, true, `checkout did not report paid:true: ${JSON.stringify(orderRes.body)}`)
  const orderNumber = orderRes.body.orderNumber
  assert.ok(orderNumber, `checkout response missing orderNumber: ${JSON.stringify(orderRes.body)}`)

  const orderRow = await queryOneD1(`SELECT id FROM orders WHERE order_number = '${orderNumber}'`)
  const orderId = orderRow.id
  const itemRow = await queryOneD1(`SELECT id, vendor_id FROM order_items WHERE order_id = ${orderId} LIMIT 1`)
  return { orderId, orderNumber, orderItemId: itemRow.id, vendorId: itemRow.vendor_id }
}
