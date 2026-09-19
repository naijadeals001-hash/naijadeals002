/**
 * Marketplace Engine — Stage 2C (Currency & Address Foundation) permanent
 * regression harness, HTTP test client. Mirrors
 * tests/identity-engine/helpers/client.mjs EXACTLY (same repo, same
 * black-box-HTTP-against-the-real-running-dev-server methodology).
 *
 * PRECONDITION: the app must already be running locally with a local D1
 * binding (`pm2 start ecosystem.config.cjs` — `wrangler pages dev dist
 * --d1=naijadeals-production --local`). This harness does NOT start the
 * server itself.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BASE_URL = process.env.MKT_TEST_BASE_URL ?? 'http://localhost:3000'
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

const DB_BINDING = process.env.MKT_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.MKT_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

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
      // IMPORTANT: fetch() follows redirects by default, which silently
      // replaces a real 302 (e.g. requireAuthPage's redirect to /login) with
      // the final destination's 200 status — masking the actual wire-level
      // status code this harness exists to verify. 'manual' surfaces the
      // true first-hop status (redirects report status 0 with type
      // 'opaqueredirect' in browsers, but Node's undici reports the real
      // 3xx status and Location header, which is what we want here).
      redirect: 'manual',
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
      json = { __nonJsonBody: text }
    }
    return { status: res.status, body: json, raw: text, location: res.headers.get('location') }
  }

  get(path, opts) {
    return this.request('GET', path, opts)
  }
  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body })
  }
  put(path, body, opts = {}) {
    return this.request('PUT', path, { ...opts, body })
  }
  delete(path, opts) {
    return this.request('DELETE', path, opts)
  }
}

/** Registers a brand-new user via the REAL HTTP endpoint and returns an authenticated client + userId + email. */
export async function registerUser(label) {
  const client = new ApiClient()
  const email = `mkttest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const password = 'TestPass123!'
  const res = await client.post('/api/auth/register', {
    name: `MarketplaceHarness ${label}`,
    email,
    password,
  })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.user?.id, `registerUser(${label}) did not return a user id`)
  return { client, userId: res.body.user.id, email, password }
}

/** Cleans up every row this harness could have created for a given RUN_NONCE. FK-safe order: children before parents. */
export async function cleanupRunNonce(nonce) {
  await execD1(
    `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%'));` +
    `DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%'));` +
    `DELETE FROM payment_transactions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM addresses WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM wallet_ledger WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM wallet_accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM users WHERE email LIKE '%${nonce}%';`
  )
}
