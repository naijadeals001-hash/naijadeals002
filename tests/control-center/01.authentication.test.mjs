/**
 * Enterprise Control Center — Phase 1, Step 12, Category 1: Authentication
 * denial matrix + authentication success. Black-box HTTP tests against the
 * real running dev server (no mocking of the service layer — every request
 * below hits the actual /control-center/* and /api/control-center/* routes
 * wired into src/index.tsx this segment).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiClient,
  registerUser,
  grantControlCenterRole,
  setUserStatus,
  countActiveSessions,
  execD1,
} from './helpers/client.mjs'

// ============================== DENIAL MATRIX ==============================

test('AUTH-DENY-1: unauthenticated GET /control-center is redirected (never rendered) to the login page', async () => {
  const anon = new ApiClient()
  const res = await anon.get('/control-center')
  assert.equal(res.status, 302, 'an unauthenticated page request must be a redirect, never a 200')
  const location = res.headers.get('location')
  assert.ok(location && location.includes('/control-center/login'), `expected redirect to login, got Location: ${location}`)
})

test('AUTH-DENY-2: unauthenticated POST to a Control Center API route returns a genuine 401 JSON error, never a redirect', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/control-center/verifications/vendors/1/decision', { decision: 'verify' })
  assert.equal(res.status, 401)
  assert.ok(res.body?.error, 'expected a JSON {error} body')
  assert.equal(res.headers.get('location'), null, 'an API 401 must never carry a redirect Location header')
})

test('AUTH-DENY-3: an authenticated CUSTOMER (zero cc_user_roles rows) cannot access the Control Center page shell', async () => {
  const { client } = await registerUser('deny_customer_page')
  const res = await client.get('/control-center')
  assert.equal(res.status, 302)
  const location = res.headers.get('location')
  assert.ok(location && location.includes('/control-center/login'), `expected redirect to login, got: ${location}`)
})

test('AUTH-DENY-3b: the SAME customer hitting the Control Center API gets a genuine 403 JSON (they ARE authenticated, they just have no CC role — distinct from AUTH-DENY-2\'s 401)', async () => {
  const { client } = await registerUser('deny_customer_api')
  const res = await client.post('/api/control-center/verifications/vendors/1/decision', { decision: 'verify' })
  assert.equal(res.status, 403, 'an authenticated-but-unauthorized caller must get 403, not 401 — the auth/authz boundary distinction must be preserved for the Control Center exactly as it is for /api/admin/*')
  assert.ok(res.body?.error)
})

test('AUTH-DENY-4: a vendor-role-holding platform user (users.role unrelated to cc_user_roles) still cannot access the Control Center — platform role is never conflated with Control Center authorization', async () => {
  const { client, userId } = await registerUser('deny_vendor_page')
  // Promote at the PLATFORM level only (users.role), never touching cc_user_roles.
  await execD1(`UPDATE users SET role = 'vendor' WHERE id = ${userId}`)

  const res = await client.get('/control-center')
  assert.equal(res.status, 302)
  const apiRes = await client.post('/api/control-center/verifications/vendors/1/decision', { decision: 'verify' })
  assert.equal(apiRes.status, 403, 'users.role=vendor must confer ZERO Control Center authorization — these are two entirely independent authorization systems')
})

test('AUTH-DENY-5: a platform-level admin (users.role=\'admin\', i.e. Marketplace Engine 2.1\'s existing admin surface) STILL cannot access the Control Center without an explicit cc_user_roles grant — no implicit bridge between the two admin systems', async () => {
  const { client, userId } = await registerUser('deny_platformadmin')
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${userId}`)

  const pageRes = await client.get('/control-center')
  assert.equal(pageRes.status, 302, 'a platform admin with zero cc_user_roles rows must be redirected exactly like any other authenticated non-CC user')

  const apiRes = await client.post('/api/control-center/verifications/vendors/1/decision', { decision: 'verify' })
  assert.equal(apiRes.status, 403, 'platform admin (users.role) must never implicitly satisfy Control Center RBAC — this is the exact bridge Phase 1\'s prompt explicitly prohibits ("no hardcoded admin bypass")')
})

test('AUTH-DENY-6: a blocked/suspended account cannot sign in to the Control Center even with correct credentials and a valid cc_user_roles grant', async () => {
  const { client, email, password, userId } = await registerUser('deny_suspended')
  await grantControlCenterRole(userId, 'support_admin')
  await setUserStatus(userId, 'suspended')

  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 403, 'a suspended account must be rejected at login even with a genuinely correct password and a real CC role grant')
  assert.ok(!/invalid credentials/i.test(res.body?.error ?? ''), 'a blocked-account rejection must be distinguishable from a bad-password rejection in the error text (mirrors api-auth.ts\'s own login route exactly)')

  // Confirm no session was actually established.
  const dashRes = await client.get('/control-center')
  assert.equal(dashRes.status, 302, 'a rejected login must never leave the client with a working session cookie')
})

test('AUTH-DENY-6b: a suspended account with a CC role also cannot authenticate via the regular POST /api/auth/login route (proves this is Engine 1\'s existing, unmodified guard, not something Control Center reinvented)', async () => {
  const { client, email, password, userId } = await registerUser('deny_suspended_regular')
  await grantControlCenterRole(userId, 'support_admin')
  await setUserStatus(userId, 'suspended')

  const res = await client.post('/api/auth/login', { identifier: email, password })
  assert.equal(res.status, 403)
})

// ============================== AUTHENTICATION SUCCESS ==============================

test('AUTH-OK-7: a valid Control Center administrator (real password + real cc_user_roles grant) can authenticate via POST /control-center/login', async () => {
  const { client, email, password, userId } = await registerUser('ok_login')
  await grantControlCenterRole(userId, 'platform_admin')

  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 200, `expected successful login, got: ${JSON.stringify(res.body)}`)
  assert.equal(res.body?.success, true)
  assert.equal(res.body?.user?.id, userId)
})

test('AUTH-OK-8: successful Control Center login establishes a REAL protected session — the SAME session cookie also authenticates the regular site (Section 5: one identity, one session), and a fresh session row exists in D1', async () => {
  const { client, email, password, userId } = await registerUser('ok_session')
  await grantControlCenterRole(userId, 'platform_admin')

  const beforeSessions = await countActiveSessions(userId)
  const loginRes = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(loginRes.status, 200)

  const cookie = client.getCookie('nd_session')
  assert.ok(cookie, 'expected the shared nd_session cookie to be set')

  const afterSessions = await countActiveSessions(userId)
  assert.equal(afterSessions, beforeSessions + 1, 'exactly one new live session row must exist in D1 after a successful login')

  // Same cookie must also authenticate the regular, non-CC site (single shared identity/session — Section 5).
  const accountRes = await client.get('/api/account/profile')
  assert.notEqual(accountRes.status, 401, 'the Control Center session cookie must be usable by the regular site\'s own authenticated routes too')
})

test('AUTH-OK-9: the Control Center dashboard (GET /control-center) is genuinely accessible after authenticating, and renders real HTML (not the login page)', async () => {
  const { client, email, password, userId } = await registerUser('ok_dashboard')
  await grantControlCenterRole(userId, 'platform_admin')
  await client.post('/control-center/login', { identifier: email, password })

  const res = await client.get('/control-center')
  assert.equal(res.status, 200)
  assert.ok(res.raw.includes('Platform Overview'), 'expected the real dashboard markup, not a login page or an error page')
  assert.ok(!res.raw.includes('cc-login-form'), 'the dashboard must not be the login page in disguise')
})

test('AUTH-OK-10: logout genuinely invalidates the session server-side — the session row is destroyed in D1, and the SAME cookie can no longer reach the dashboard', async () => {
  const { client, email, password, userId } = await registerUser('ok_logout')
  await grantControlCenterRole(userId, 'platform_admin')
  await client.post('/control-center/login', { identifier: email, password })

  const beforeSessions = await countActiveSessions(userId)
  assert.ok(beforeSessions >= 1)

  const sessionCookieBeforeLogout = client.getCookie('nd_session')

  const logoutRes = await client.post('/control-center/logout')
  assert.equal(logoutRes.status, 302, 'logout must redirect (real server action), not just return JSON success')

  const afterSessions = await countActiveSessions(userId)
  assert.equal(afterSessions, beforeSessions - 1, 'logout must destroy exactly the one session row it invalidated in D1 — a real server-side revocation, not a client-side-only cookie clear')

  // Re-attach the OLD cookie value explicitly (simulating a client that
  // ignored the Set-Cookie clear and replayed the stale token) to prove
  // the session is truly dead server-side, not merely uncookied client-side.
  const replay = new ApiClient()
  replay.setCookie('nd_session', sessionCookieBeforeLogout)
  const replayRes = await replay.get('/control-center')
  assert.equal(replayRes.status, 302, 'replaying the destroyed session token must be denied — proves server-side invalidation, not merely a cleared client cookie')
})
