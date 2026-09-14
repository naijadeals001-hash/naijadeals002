/**
 * Enterprise Control Center — Phase 1 permanent regression harness, HTTP
 * test client. Mirrors tests/identity-engine/helpers/client.mjs EXACTLY
 * (same repo, same black-box-HTTP-against-the-real-running-dev-server
 * methodology, same execD1/queryD1/queryOneD1 wrangler-CLI pattern) —
 * deliberately not reinvented.
 *
 * PRECONDITION: the app must already be running locally with a local D1
 * binding (`pm2 start ecosystem.config.cjs` — `wrangler pages dev dist
 * --d1=... --local`). This harness does NOT start the server itself.
 *
 * TEST-ONLY ROLE GRANT (grantControlCenterRole / revokeAllControlCenterRoles
 * below): mirrors promoteToAdmin()'s existing, established precedent in
 * tests/identity-engine/helpers/client.mjs EXACTLY — a direct D1 INSERT
 * into cc_user_roles. This is NOT a new capability: there has never been,
 * and this file does NOT add, any public self-service "grant myself a
 * Control Center role" HTTP endpoint. The application itself has zero
 * knowledge this helper exists; it is pure test-harness plumbing that
 * talks directly to the SQLite file, exactly the way promoteToAdmin()
 * bypasses the (deliberately nonexistent) "become platform admin" endpoint.
 * No production code path is touched or weakened by this helper's existence.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BASE_URL = process.env.CC_TEST_BASE_URL ?? 'http://localhost:3000'
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

const DB_BINDING = process.env.CC_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.CC_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

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

  setCookie(name, value) {
    this.cookies.set(name, value)
  }

  getCookie(name) {
    return this.cookies.get(name) ?? null
  }

  /** Removes every captured cookie — simulates a fully logged-out browser reusing the same ApiClient instance (used by the logout-then-revisit test). */
  clearCookies() {
    this.cookies.clear()
  }

  async request(method, path, { body, headers = {}, redirect = 'manual' } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      redirect,
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
    return { status: res.status, body: json, raw: text, headers: res.headers }
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

/**
 * Registers a brand-new user via the REAL HTTP endpoint (POST /api/auth/register)
 * and returns an authenticated client + userId + email + password. Identical in
 * spirit to identity-engine's registerUser() but namespaced under 'cctest_' so
 * cleanupRunNonce()/cleanupAllControlCenterTestFixtures() below can never collide
 * with (or accidentally sweep up) identity-engine's own 'idtest_' fixtures.
 */
export async function registerUser(label) {
  const client = new ApiClient()
  const email = `cctest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const password = 'TestPass123!'
  const res = await client.post('/api/auth/register', {
    name: `CCHarness ${label}`,
    email,
    password,
  })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.user?.id, `registerUser(${label}) did not return a user id`)
  return { client, userId: res.body.user.id, email, password, sessionCookie: client.getCookie('nd_session') }
}

/**
 * TEST-ONLY: grants a Control Center role to a user by inserting directly
 * into cc_user_roles — mirrors promoteToAdmin()'s established, pre-existing
 * pattern (direct-D1-write test fixture, no production endpoint involved).
 * `assignedByUserId` defaults to the target user's own id purely to satisfy
 * the FK-shaped column meaningfully in test data; it carries no authorization
 * significance (cc_user_roles.assigned_by_user_id is an audit/provenance
 * column only, never read for access-control decisions anywhere in
 * src/lib/control-center-rbac.ts).
 */
export async function grantControlCenterRole(userId, roleKey, assignedByUserId = userId) {
  const roleRow = await queryOneD1(`SELECT id FROM cc_roles WHERE key = '${roleKey}'`)
  assert.ok(roleRow, `grantControlCenterRole: unknown cc_roles.key '${roleKey}' — check migration 0050's seed data`)
  await execD1(
    `INSERT INTO cc_user_roles (user_id, role_id, assigned_by_user_id) VALUES (${Number(userId)}, ${roleRow.id}, ${Number(assignedByUserId)})`
  )
  return roleRow.id
}

/** TEST-ONLY: removes every Control Center role from a user directly via D1 — used to prove "removing a permission immediately prevents the protected operation" (Phase 1 prompt Step 12). */
export async function revokeAllControlCenterRoles(userId) {
  await execD1(`DELETE FROM cc_user_roles WHERE user_id = ${Number(userId)}`)
}

/** TEST-ONLY: removes a single named role (rather than all roles) from a user, so a test can move a user from one role to a DIFFERENT, more-restricted role without fully de-authorizing them. */
export async function revokeControlCenterRole(userId, roleKey) {
  await execD1(
    `DELETE FROM cc_user_roles WHERE user_id = ${Number(userId)} AND role_id = (SELECT id FROM cc_roles WHERE key = '${roleKey}')`
  )
}

/** Reads a user's current users.status directly via D1 (ground truth). */
export async function getUserStatus(userId) {
  const row = await queryOneD1(`SELECT status FROM users WHERE id = ${Number(userId)}`)
  return row ? row.status : null
}

/** TEST-ONLY: sets a user's users.status directly via D1 — used to construct the "blocked/suspended account cannot access Control Center" fixture without needing a full admin-suspend HTTP round trip. */
export async function setUserStatus(userId, status) {
  await execD1(`UPDATE users SET status = '${status}' WHERE id = ${Number(userId)}`)
}

/**
 * Creates a real, minimal `vendors` row directly via D1 with
 * verification_status='pending' — the exact real-world precondition the
 * Control Center vendor verification queue reads (see
 * control-center-verification.ts's getPendingVendorVerifications()). This
 * is a TEST FIXTURE helper only: it does not simulate or replace the real
 * seller-onboarding flow (src/lib/stores.ts's createOrganizationStore /
 * the individual-seller onboarding path), it just seeds the SAME table
 * those paths write to, at the SAME pending state a genuinely-onboarding
 * seller would be in before an admin ever looks at them.
 */
export async function createTestVendor(label, { verificationStatus = 'pending' } = {}) {
  // getPendingVendorVerifications() (control-center-verification.ts) filters
  // `WHERE verification_status = 'pending' AND user_id IS NOT NULL` — this
  // matches the real onboarding precondition (an individual seller's vendor
  // row is ALWAYS owned by a user_id; only the 20 pre-existing catalog-seed
  // vendors have NULL user_id, and those are deliberately excluded from the
  // admin verification queue). The fixture must own a real user_id to be a
  // faithful stand-in for a genuinely-onboarding seller.
  const { userId: ownerUserId } = await registerUser(`vendorowner_${label}`)
  const slug = `cctest-vendor-${label}-${RUN_NONCE}-${Math.floor(Math.random() * 1e6)}`
  const businessEmail = `cctest_${label}_${RUN_NONCE}@test.ng`
  const row = await queryOneD1(
    `INSERT INTO vendors (slug, name, business_name, business_email, city, state, verification_status, store_status, user_id)
     VALUES ('${slug}', '${slug}', '${slug} Ltd', '${businessEmail}', 'Lagos', 'Lagos', '${verificationStatus}', 'active', ${ownerUserId})
     RETURNING id, slug, verification_status, store_status`
  )
  return { ...row, ownerUserId }
}

/** Reads a vendor's current verification_status/store_status directly via D1 (ground truth, independent of any Control Center read path). */
export async function getVendorStatus(vendorId) {
  return queryOneD1(`SELECT verification_status, store_status FROM vendors WHERE id = ${Number(vendorId)}`)
}

/**
 * Creates a real, minimal `provider_profiles` row directly via D1, owned by
 * a freshly-registered throwaway user (provider_profiles.user_id is
 * NOT NULL + FK'd), with verification_status='pending' — the exact
 * precondition the Control Center provider verification queue reads.
 */
export async function createTestProvider(label, { verificationStatus = 'pending' } = {}) {
  const { userId } = await registerUser(`providerowner_${label}`)
  const displayName = `CC Test Provider ${label} ${RUN_NONCE}`
  const row = await queryOneD1(
    `INSERT INTO provider_profiles (user_id, provider_type, display_name, contact_email, country_iso, verification_status, operational_status)
     VALUES (${userId}, 'gig_provider', '${displayName}', 'cctest_${label}_${RUN_NONCE}@test.ng', 'NG', '${verificationStatus}', 'active')
     RETURNING id, verification_status, operational_status`
  )
  return { ...row, ownerUserId: userId }
}

/** Reads a provider profile's current verification_status/operational_status directly via D1. */
export async function getProviderStatus(providerProfileId) {
  return queryOneD1(`SELECT verification_status, operational_status FROM provider_profiles WHERE id = ${Number(providerProfileId)}`)
}

/** Reads the most recent cc_audit_logs row for a given action+entity pair — the real-data assertion target for every audit test below (never a mock). */
export async function getLatestAuditLog(action, entityType, entityId) {
  return queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action = '${action}' AND entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY id DESC LIMIT 1`
  )
}

/** Counts cc_audit_logs rows matching a filter — used to assert "no new audit row was created" for denied/failed attempts. */
export async function countAuditLogs(action, entityType, entityId) {
  const row = await queryOneD1(
    `SELECT COUNT(*) AS n FROM cc_audit_logs WHERE action = '${action}' AND entity_type = '${entityType}' AND entity_id = '${entityId}'`
  )
  return row ? Number(row.n) : 0
}

/** Counts a user's live (unexpired) session rows directly via D1 — used to prove logout actually revoked the session server-side, not just cleared a cookie client-side. */
export async function countActiveSessions(userId) {
  const row = await queryOneD1(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${Number(userId)} AND expires_at > datetime('now')`)
  return row ? Number(row.n) : 0
}

/**
 * Cleans up every row this harness could have created for a given RUN_NONCE
 * — FK-safe order (children before parents), mirroring identity-engine's
 * cleanupRunNonce() technique exactly, extended with the Control-Center-
 * specific tables this harness additionally writes to (cc_user_roles,
 * provider_profile_status_events, and the test vendor rows themselves).
 */
export async function cleanupRunNonce(nonce) {
  await execD1(
    `DELETE FROM cc_user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM provider_profile_status_events WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE contact_email LIKE '%${nonce}%');` +
    `DELETE FROM provider_profiles WHERE contact_email LIKE '%${nonce}%';` +
    `DELETE FROM vendors WHERE slug LIKE 'cctest-vendor-%${nonce}%';` +
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM cc_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM cc_domain_events WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE '%${nonce}%');` +
    `DELETE FROM login_attempts WHERE identifier LIKE '%${nonce}%';` +
    `DELETE FROM users WHERE email LIKE '%${nonce}%';`
  )
}

/** Broader sweep matching ANY row this harness has ever created across all RUN_NONCE values in one sandbox session (the 'cctest_' prefix). Intended for a single final cleanup pass, mirroring identity-engine's cleanupAllIdentityTestFixtures(). */
export async function cleanupAllControlCenterTestFixtures() {
  await execD1(
    `DELETE FROM cc_user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'cctest_%');` +
    `DELETE FROM provider_profile_status_events WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE contact_email LIKE 'cctest_%');` +
    `DELETE FROM provider_profiles WHERE contact_email LIKE 'cctest_%';` +
    `DELETE FROM vendors WHERE slug LIKE 'cctest-vendor-%';` +
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'cctest_%');` +
    `DELETE FROM cc_audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'cctest_%');` +
    `DELETE FROM cc_domain_events WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE 'cctest_%');` +
    `DELETE FROM login_attempts WHERE identifier LIKE 'cctest_%';` +
    `DELETE FROM users WHERE email LIKE 'cctest_%';`
  )
}
