/**
 * Identity & Access Engine (Engine 1) — permanent regression harness, HTTP
 * test client. Mirrors tests/booking-engine/helpers/client.mjs and
 * tests/notification-engine/helpers/client.mjs EXACTLY (same repo, same
 * black-box-HTTP-against-the-real-running-dev-server methodology) —
 * deliberately not reinvented for the one engine (Identity) that most
 * needs to prove its HTTP surface behaves exactly as a real browser/client
 * would see it.
 *
 * PRECONDITION: the app must already be running locally with a local D1
 * binding (`pm2 start ecosystem.config.cjs` — `wrangler pages dev dist
 * --d1=... --local`). This harness does NOT start the server itself.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BASE_URL = process.env.IDENTITY_TEST_BASE_URL ?? 'http://localhost:3000'
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

const DB_BINDING = process.env.IDENTITY_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.IDENTITY_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

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

  /** Removes the cookie entirely — used to simulate "the session was already destroyed server-side but the client tries to keep using the cookie value it captured earlier" style checks (we re-set from a saved raw value instead). */
  setCookie(name, value) {
    this.cookies.set(name, value)
  }

  getCookie(name) {
    return this.cookies.get(name) ?? null
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
      json = { __nonJsonBody: text }
    }
    return { status: res.status, body: json, raw: text }
  }

  get(path, opts) {
    return this.request('GET', path, opts)
  }
  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body })
  }
  patch(path, body, opts = {}) {
    return this.request('PATCH', path, { ...opts, body })
  }
  delete(path, opts) {
    return this.request('DELETE', path, opts)
  }
}

/** Registers a brand-new user via the REAL HTTP endpoint and returns an authenticated client + userId + email + the raw session cookie value (for later "clone the cookie onto a fresh client" scenarios). */
export async function registerUser(label) {
  const client = new ApiClient()
  const email = `idtest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const password = 'TestPass123!'
  const res = await client.post('/api/auth/register', {
    name: `IdentityHarness ${label}`,
    email,
    password,
  })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.user?.id, `registerUser(${label}) did not return a user id`)
  return { client, userId: res.body.user.id, email, password, sessionCookie: client.getCookie('nd_session') }
}

/** Promotes a user to platform role 'admin' directly via D1 (there is no public self-service "become admin" endpoint by design — mirrors notification-engine's promoteToAdmin rationale exactly). */
export async function promoteToAdmin(userId) {
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${Number(userId)}`)
}

/** Reads a user's current users.status directly via D1 (ground truth, bypassing any HTTP caching concerns). */
export async function getUserStatus(userId) {
  const row = await queryOneD1(`SELECT status FROM users WHERE id = ${Number(userId)}`)
  return row ? row.status : null
}

/** Counts a user's live (unexpired) session rows directly via D1 — used to prove a status-mutation actually revoked sessions server-side. */
export async function countActiveSessions(userId) {
  const row = await queryOneD1(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${Number(userId)} AND expires_at > datetime('now')`)
  return row ? Number(row.n) : 0
}

/** Cleans up every row this harness could have created for a given RUN_NONCE — organizations/memberships/invitations first (FK children), then sessions, then users (FK-safe order matching the search-engine harness's established cleanup technique). Call at the end of a test file's top-level teardown, or rely on the shared cleanup script (scripts/identity-engine-cleanup.sh). */
export async function cleanupRunNonce(nonce) {
  await execD1(
    `DELETE FROM organization_invitations WHERE invited_email LIKE '%${nonce}%';` +
    `DELETE FROM organization_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM organizations WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM cc_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%') OR entity_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM cc_domain_events WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%') OR entity_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM account_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM identity_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM login_attempts WHERE identifier LIKE '%${nonce}%';` +
    `DELETE FROM notification_deliveries WHERE outbox_id IN (SELECT id FROM notification_outbox WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%'));` +
    `DELETE FROM notification_outbox WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM users WHERE email LIKE '%${nonce}%';`
  )
}

/**
 * Broader sweep used by the final consolidated cleanup pass: matches ANY
 * row whose associated user email matches the 'idtest_' prefix (covers
 * every RUN_NONCE this harness has ever generated across all test files
 * in a single sandbox session), not just one specific nonce. Intended to
 * be called once, at the very end of the full identity-engine test run.
 */
export async function cleanupAllIdentityTestFixtures() {
  await execD1(
    `DELETE FROM organization_invitations WHERE invited_email LIKE 'idtest_%';` +
    `DELETE FROM organization_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM organizations WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM cc_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%') OR entity_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM cc_domain_events WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%') OR entity_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM account_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM identity_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM login_attempts WHERE identifier LIKE 'idtest_%';` +
    `DELETE FROM notification_deliveries WHERE outbox_id IN (SELECT id FROM notification_outbox WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%'));` +
    `DELETE FROM notification_outbox WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE 'idtest_%');` +
    `DELETE FROM users WHERE email LIKE 'idtest_%';`
  )
}
