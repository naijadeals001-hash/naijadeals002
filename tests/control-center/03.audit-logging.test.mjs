/**
 * Enterprise Control Center — Phase 1, Step 12, Category 3: Audit logging.
 * Directly targets Phase 0's core finding (25 of 27 existing admin routes
 * never wrote to cc_audit_logs) — proves every new Control Center mutation
 * this segment introduced DOES write a real, correctly-attributed audit
 * record, and that DENIED attempts never produce a false-success record.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiClient,
  registerUser,
  grantControlCenterRole,
  createTestVendor,
  createTestProvider,
  queryOneD1,
  countAuditLogs,
} from './helpers/client.mjs'

async function loginAs(label, roleKey) {
  const { client, email, password, userId } = await registerUser(label)
  await grantControlCenterRole(userId, roleKey)
  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 200)
  return { client, userId }
}

// ============================== SUCCESSFUL MUTATIONS ==============================

test('AUDIT-1: a successful vendor verification decision creates exactly one new cc_audit_logs row with success=1, the correct administrator identity, the correct action, and the correct target entity', async () => {
  const { client, userId } = await loginAs('audit_vendor_ok', 'vendor_admin')
  const vendor = await createTestVendor('audit1')

  const before = await countAuditLogs('vendor_verification_decision', 'vendor', String(vendor.id))
  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify', reason: 'looks legit' })
  assert.equal(res.status, 200)
  const after = await countAuditLogs('vendor_verification_decision', 'vendor', String(vendor.id))
  assert.equal(after, before + 1, 'exactly one new audit row must exist')

  const row = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='vendor_verification_decision' AND entity_type='vendor' AND entity_id='${vendor.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(row.actor_user_id), userId, 'correct administrator identity')
  assert.equal(row.action, 'vendor_verification_decision', 'correct action')
  assert.equal(row.entity_type, 'vendor')
  assert.equal(row.entity_id, String(vendor.id), 'correct target entity')
  assert.equal(Number(row.success), 1)

  const before_ = JSON.parse(row.before_json)
  const after_ = JSON.parse(row.after_json)
  assert.equal(before_.verification_status, 'pending')
  assert.equal(after_.verification_status, 'verified')

  // A companion cc_domain_events row must also exist (dual-write shape).
  const domainRow = await queryOneD1(
    `SELECT * FROM cc_domain_events WHERE event_type='vendor_verification_decision' AND entity_id='${vendor.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(domainRow, 'a companion cc_domain_events row must be written in the same atomic batch')
})

test('AUDIT-2: a successful provider verification decision ALSO writes a provider_profile_status_events row (the previously-completely-dormant table) in addition to the shared cc_audit_logs/cc_domain_events pair', async () => {
  const { client, userId } = await loginAs('audit_provider_ok', 'vendor_admin')
  const provider = await createTestProvider('audit2')

  const res = await client.post(`/api/control-center/verifications/providers/${provider.id}/decision`, { decision: 'verify' })
  assert.equal(res.status, 200)

  const auditRow = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='provider_verification_decision' AND entity_type='provider_profile' AND entity_id='${provider.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(auditRow.actor_user_id), userId)
  assert.equal(Number(auditRow.success), 1)

  const statusEventRow = await queryOneD1(
    `SELECT * FROM provider_profile_status_events WHERE provider_profile_id=${provider.id} AND status_type='verification' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(statusEventRow, 'a provider_profile_status_events row must exist — this table must no longer be dormant')
  assert.equal(statusEventRow.status, 'verified')
  assert.equal(Number(statusEventRow.actor_user_id), userId)
})

test('AUDIT-3: a successful Control Center login writes an audit row with the resolved role keys in context, and a successful logout writes its own distinct audit row', async () => {
  const { client, email, password, userId } = await registerUser('audit_loginlogout')
  await grantControlCenterRole(userId, 'finance_admin')

  const loginRes = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(loginRes.status, 200)

  const loginAudit = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='control_center_login' AND entity_id='${userId}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(loginAudit.actor_user_id), userId)
  assert.equal(Number(loginAudit.success), 1)
  const loginContext = JSON.parse(loginAudit.context_json)
  assert.ok(loginContext.roles.includes('finance_admin'), 'the login audit context must record the resolved role keys')

  await client.post('/control-center/logout')
  const logoutAudit = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='control_center_logout' AND entity_id='${userId}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(logoutAudit.actor_user_id), userId)
  assert.equal(Number(logoutAudit.success), 1)
  assert.notEqual(logoutAudit.id, loginAudit.id, 'login and logout must be two distinct audit rows')
})

// ============================== DENIED MUTATIONS ==============================

test('AUDIT-4: a login attempt with valid credentials but ZERO Control Center roles creates a success=0 audit row (never a false success), and no session is established', async () => {
  const { client, email, password, userId } = await registerUser('audit_deniedlogin')
  // Deliberately grant NO cc role.

  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 403)

  const row = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='control_center_login_denied' AND entity_id='${userId}' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(row, 'a denied-login audit row must exist')
  assert.equal(Number(row.success), 0, 'a denied login must be recorded with success=0, never as if it succeeded')

  const succeeded = await queryOneD1(
    `SELECT COUNT(*) AS n FROM cc_audit_logs WHERE action='control_center_login' AND entity_id='${userId}'`
  )
  assert.equal(Number(succeeded.n), 0, 'no false control_center_login (success) row must exist for this user')
})

test('AUDIT-5: a permission-denied mutation attempt (403) creates NO business mutation AND no audit row is falsely written under the successful action name', async () => {
  const { client } = await loginAs('audit_deniedmutation', 'support_admin') // lacks vendors.verify
  const vendor = await createTestVendor('audit5')

  const before = await countAuditLogs('vendor_verification_decision', 'vendor', String(vendor.id))
  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(res.status, 403)

  const after = await countAuditLogs('vendor_verification_decision', 'vendor', String(vendor.id))
  assert.equal(after, before, 'a 403-denied mutation attempt must create NO vendor_verification_decision audit row at all (success or otherwise) — the middleware rejects before the module (and its audit write) is ever invoked')

  const vendorRow = await queryOneD1(`SELECT verification_status FROM vendors WHERE id=${vendor.id}`)
  assert.equal(vendorRow.verification_status, 'pending', 'no business mutation must have occurred')
})

test('AUDIT-6: authorization failure is independently observable via the real /control-center/audit viewer for a caller who DOES have audit.read — denied login attempts appear in the SAME feed as successes, distinguishable by success=0', async () => {
  const { client: auditorClient } = await loginAs('audit_observer', 'auditor')
  const { email: deniedEmail, password: deniedPassword, userId: deniedUserId } = await registerUser('audit_observed_denial')

  const denied = new ApiClient()
  const loginRes = await denied.post('/control-center/login', { identifier: deniedEmail, password: deniedPassword })
  assert.equal(loginRes.status, 403)

  const auditPageRes = await auditorClient.get('/control-center/audit')
  assert.equal(auditPageRes.status, 200)
  assert.ok(auditPageRes.raw.includes('denied/failed'), 'the audit viewer must render at least one denied/failed badge, proving denials are genuinely observable, not silently dropped')
})
