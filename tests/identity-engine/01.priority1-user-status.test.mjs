/**
 * Engine 1 Identity & Access Completion — Priority 1: users.status
 * enforcement. Black-box HTTP tests against the real running dev server,
 * mirroring tests/booking-engine/helpers/client.mjs's methodology exactly.
 *
 * PRECONDITION: PM2 dev server running (`pm2 start ecosystem.config.cjs`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, promoteToAdmin, getUserStatus, countActiveSessions, execD1, queryOneD1, ApiClient } from './helpers/client.mjs'

test('users.status: a freshly registered user has status "active" and can access protected resources', async () => {
  const { client } = await registerUser('active_check')
  const res = await client.get('/api/auth/me')
  assert.equal(res.status, 200)
  assert.equal(res.body.user.status, 'active')
})

test('users.status: admin-mutation to "suspended" causes /api/auth/me to return null on the very next request with the SAME (previously valid) session cookie', async () => {
  const { client: target, userId: targetId } = await registerUser('suspend_target')
  const { client: admin, userId: adminId } = await registerUser('suspend_admin')
  await promoteToAdmin(adminId)

  // Confirm session works before suspension
  const before = await target.get('/api/auth/me')
  assert.equal(before.status, 200)
  assert.ok(before.body.user)

  const decision = await admin.post(`/api/admin/users/${targetId}/status`, { status: 'suspended', reason: 'test' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.previousStatus, 'active')
  assert.equal(decision.body.newStatus, 'suspended')
  assert.equal(decision.body.sessionsRevoked, true)

  // CRITICAL security test: same cookie jar, old session token, must now be null
  const after = await target.get('/api/auth/me')
  assert.equal(after.status, 200)
  assert.equal(after.body.user, null, 'a session created BEFORE suspension must not survive it')

  const dbStatus = await getUserStatus(targetId)
  assert.equal(dbStatus, 'suspended')
  const sessions = await countActiveSessions(targetId)
  assert.equal(sessions, 0, 'suspension must proactively destroy the session row, not just rely on attachUser re-checking')
})

test('users.status: suspended user cannot log back in with correct credentials (403, not silently succeeding)', async () => {
  const { client, userId, email, password } = await registerUser('suspend_relogin')
  const { client: admin, userId: adminId } = await registerUser('suspend_relogin_admin')
  await promoteToAdmin(adminId)
  await admin.post(`/api/admin/users/${userId}/status`, { status: 'suspended' })

  const freshClient = new ApiClient() // simulates a brand new browser tab, no stale cookie
  const loginRes = await freshClient.post('/api/auth/login', { identifier: email, password })
  assert.equal(loginRes.status, 403, 'a suspended account must not be able to establish a NEW session either')
  assert.match(loginRes.body.error, /not available|suspend/i)

  // Correct credentials must NOT be revealed as "invalid" (that would be a
  // dishonest error, and would also leak which failure axis is true) —
  // confirmed above via the 403 status + message being distinct from the
  // generic 401 "Invalid credentials" used for wrong password.
})

test('users.status: "disabled" status blocks protected access exactly like "suspended"', async () => {
  const { client: target, userId: targetId } = await registerUser('disabled_target')
  const { client: admin, userId: adminId } = await registerUser('disabled_admin')
  await promoteToAdmin(adminId)

  await admin.post(`/api/admin/users/${targetId}/status`, { status: 'disabled' })
  const after = await target.get('/api/auth/me')
  assert.equal(after.body.user, null)
  const sessions = await countActiveSessions(targetId)
  assert.equal(sessions, 0)
})

test('users.status: "deleted" status blocks protected access exactly like "suspended"/"disabled"', async () => {
  const { client: target, userId: targetId } = await registerUser('deleted_target')
  const { client: admin, userId: adminId } = await registerUser('deleted_admin')
  await promoteToAdmin(adminId)

  await admin.post(`/api/admin/users/${targetId}/status`, { status: 'deleted' })
  const after = await target.get('/api/auth/me')
  assert.equal(after.body.user, null)
  const sessions = await countActiveSessions(targetId)
  assert.equal(sessions, 0)
})

test('users.status: "pending_verification" does NOT block access — deliberately consistent with Engine 11 search-eligibility.ts precedent', async () => {
  const { client: target, userId: targetId } = await registerUser('pending_target')
  const { client: admin, userId: adminId } = await registerUser('pending_admin')
  await promoteToAdmin(adminId)

  const decision = await admin.post(`/api/admin/users/${targetId}/status`, { status: 'pending_verification' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.sessionsRevoked, false, 'pending_verification must NOT trigger the same session-revocation as a blocked status')

  const after = await target.get('/api/auth/me')
  assert.equal(after.status, 200)
  assert.ok(after.body.user, 'a pending_verification user must remain able to use their existing session')
  assert.equal(after.body.user.status, 'pending_verification')
})

test('users.status: admin mutation to an invalid status value is rejected with 400', async () => {
  const { userId: targetId } = await registerUser('invalid_status_target')
  const { client: admin, userId: adminId } = await registerUser('invalid_status_admin')
  await promoteToAdmin(adminId)

  const res = await admin.post(`/api/admin/users/${targetId}/status`, { status: 'not_a_real_status' })
  assert.equal(res.status, 400)
})

test('users.status: mutation on a nonexistent user id returns 404', async () => {
  const { client: admin, userId: adminId } = await registerUser('nonexistent_target_admin')
  await promoteToAdmin(adminId)
  const res = await admin.post('/api/admin/users/999999999/status', { status: 'suspended' })
  assert.equal(res.status, 404)
})

// ---------- Authorization boundary tests (Priority 1's explicit "reject unauthorized/cross-user mutation" requirement) ----------

test('users.status: an ordinary (non-admin) authenticated user CANNOT mutate ANY user\'s status — including their own — 403', async () => {
  const { client: normal, userId: normalId } = await registerUser('nonadmin_self')
  const res = await normal.post(`/api/admin/users/${normalId}/status`, { status: 'suspended' })
  assert.equal(res.status, 403)

  const stillActive = await getUserStatus(normalId)
  assert.equal(stillActive, 'active', 'a rejected mutation attempt must not have any side effect on the target')
})

test('users.status: an ordinary (non-admin) authenticated user CANNOT mutate a DIFFERENT user\'s status — 403, cross-user mutation rejected', async () => {
  const { client: attacker } = await registerUser('nonadmin_attacker')
  const { userId: victimId } = await registerUser('nonadmin_victim')
  const res = await attacker.post(`/api/admin/users/${victimId}/status`, { status: 'suspended' })
  assert.equal(res.status, 403)
  const stillActive = await getUserStatus(victimId)
  assert.equal(stillActive, 'active')
})

test('users.status: a completely unauthenticated request cannot mutate any user\'s status — 401', async () => {
  const { userId: victimId } = await registerUser('unauth_victim')
  const anon = new ApiClient()
  const res = await anon.post(`/api/admin/users/${victimId}/status`, { status: 'suspended' })
  assert.equal(res.status, 401)
  const stillActive = await getUserStatus(victimId)
  assert.equal(stillActive, 'active')
})

test('users.status: a successful admin mutation writes exactly one cc_audit_logs row with correct actor/before/after/action, and one cc_domain_events row', async () => {
  const { userId: targetId } = await registerUser('audit_target')
  const { client: admin, userId: adminId, email: adminEmail } = await registerUser('audit_admin')
  await promoteToAdmin(adminId)

  await admin.post(`/api/admin/users/${targetId}/status`, { status: 'suspended', reason: 'audit test' })

  const auditRow = await queryOneD1(
    `SELECT actor_user_id, action, entity_type, entity_id, before_json, after_json, success FROM cc_audit_logs WHERE action='user_status_decision' AND entity_id='${targetId}' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(auditRow, 'expected a cc_audit_logs row for this status mutation')
  assert.equal(auditRow.actor_user_id, adminId)
  assert.equal(auditRow.entity_type, 'user')
  assert.equal(Number(auditRow.entity_id), targetId)
  assert.equal(auditRow.success, 1)
  assert.match(auditRow.before_json, /"status":"active"/)
  assert.match(auditRow.after_json, /"status":"suspended"/)

  const eventRow = await queryOneD1(
    `SELECT actor_user_id, entity_type, entity_id, payload_json FROM cc_domain_events WHERE event_type='user_status_decision' AND entity_id='${targetId}' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(eventRow, 'expected a cc_domain_events row for this status mutation')
  assert.equal(eventRow.actor_user_id, adminId)
})

test('users.status: Engine 1 (auth.ts) and Engine 11 (search-eligibility.ts) agree on which statuses are disqualifying — suspended/disabled/deleted block, pending_verification does not', async () => {
  // This is a static-contract test: both files independently define their
  // own disqualifying-status set. We assert the DB-observable behavior
  // (already exercised above) is internally consistent by re-reading the
  // actual source files and checking their disqualifying-status lists
  // match, closing the exact inconsistency the Engine 1 gap-matrix audit
  // originally flagged.
  const fs = await import('node:fs/promises')
  const authSrc = await fs.readFile(new URL('../../src/lib/auth.ts', import.meta.url), 'utf-8')
  const eligibilitySrc = await fs.readFile(new URL('../../src/lib/search-eligibility.ts', import.meta.url), 'utf-8')

  assert.match(authSrc, /BLOCKED_ACCOUNT_STATUSES\s*=\s*new Set\(\[['"]suspended['"],\s*['"]disabled['"],\s*['"]deleted['"]\]\)/)
  assert.match(eligibilitySrc, /suspended['"]\s*\|\|.*disabled['"]\s*\|\|.*deleted['"]/s)
  assert.doesNotMatch(authSrc, /BLOCKED_ACCOUNT_STATUSES[\s\S]{0,200}pending_verification/, 'pending_verification must NOT be added to auth.ts\'s blocked set without an explicit, deliberate decision — Engine 11 does not disqualify it either')
})
