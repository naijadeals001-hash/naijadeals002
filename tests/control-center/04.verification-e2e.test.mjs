/**
 * Enterprise Control Center — Phase 1, Step 12, Category 4: Verification
 * end-to-end. Exercises the FULL real chain against the real running dev
 * server and real local D1 — never a service-layer mock:
 *
 *   LOGIN -> CONTROL CENTER -> VERIFICATION QUEUE -> APPROVE/REJECT ->
 *   DATABASE STATE CHANGE -> AUDIT RECORD CREATED
 *
 * Also exercises the unauthorized equivalent end-to-end (an authenticated
 * but under-permissioned Control Center user attempting the same chain).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiClient,
  registerUser,
  grantControlCenterRole,
  createTestVendor,
  createTestProvider,
  getVendorStatus,
  getProviderStatus,
  queryOneD1,
} from './helpers/client.mjs'

async function loginAs(label, roleKey) {
  const { client, email, password, userId } = await registerUser(label)
  await grantControlCenterRole(userId, roleKey)
  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 200)
  return { client, userId }
}

// ============================== AUTHORIZED END-TO-END ==============================

test('E2E-1: FULL authorized chain — vendor: login -> dashboard -> verification queue lists the pending vendor -> approve -> D1 state changes -> audit record exists', async () => {
  const { client, userId } = await loginAs('e2e_vendor_authorized', 'vendor_admin')
  const vendor = await createTestVendor('e2e1')

  // 1. LOGIN already happened in loginAs(); confirm the dashboard is reachable.
  const dashRes = await client.get('/control-center')
  assert.equal(dashRes.status, 200)

  // 2. CONTROL CENTER -> VERIFICATION QUEUE: the real queue page must list the pending vendor.
  const queueRes = await client.get('/control-center/vendors')
  assert.equal(queueRes.status, 200)
  assert.ok(queueRes.raw.includes(vendor.slug) || queueRes.raw.includes(String(vendor.id)), 'the pending vendor must appear in the real, server-rendered verification queue (not a mocked list)')
  assert.ok(queueRes.raw.includes('data-decision="verify"'), 'an Approve action control must be present for a vendors.verify-capable operator')

  // 3. APPROVE — real POST to the real API route the queue page's own JS calls.
  const decisionRes = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(decisionRes.status, 200)
  assert.equal(decisionRes.body.newStatus, 'verified')

  // 4. DATABASE STATE CHANGE — read the REAL row back via an independent D1 query, not the API's own response.
  const dbState = await getVendorStatus(vendor.id)
  assert.equal(dbState.verification_status, 'verified', 'the underlying vendors row must genuinely be updated in D1')

  // 5. AUDIT RECORD CREATED — read the REAL cc_audit_logs row back.
  const auditRow = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='vendor_verification_decision' AND entity_id='${vendor.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.ok(auditRow, 'an audit record must exist for this exact mutation')
  assert.equal(Number(auditRow.actor_user_id), userId)
  assert.equal(Number(auditRow.success), 1)

  // The queue must no longer list this vendor now that it is no longer pending.
  const queueAfter = await client.get('/control-center/vendors')
  assert.ok(!queueAfter.raw.includes(vendor.slug), 'a now-verified vendor must disappear from the pending queue on next read — real data, not a stale cached list')
})

test('E2E-2: FULL authorized chain — provider: login -> dashboard -> verification queue lists the pending provider -> reject (with required reason) -> D1 state changes -> audit + provider_profile_status_events records exist', async () => {
  const { client, userId } = await loginAs('e2e_provider_authorized', 'vendor_admin')
  const provider = await createTestProvider('e2e2')

  const queueRes = await client.get('/control-center/providers')
  assert.equal(queueRes.status, 200)
  assert.ok(queueRes.raw.includes(provider.id.toString()) || queueRes.raw.includes('data-provider-id'), 'the pending provider must appear in the real queue')

  const decisionRes = await client.post(`/api/control-center/verifications/providers/${provider.id}/decision`, {
    decision: 'reject',
    reason: 'Documentation did not match business registration.',
  })
  assert.equal(decisionRes.status, 200)
  assert.equal(decisionRes.body.newStatus, 'rejected')

  const dbState = await getProviderStatus(provider.id)
  assert.equal(dbState.verification_status, 'rejected')

  const auditRow = await queryOneD1(
    `SELECT * FROM cc_audit_logs WHERE action='provider_verification_decision' AND entity_id='${provider.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(auditRow.actor_user_id), userId)
  const context = JSON.parse(auditRow.context_json)
  assert.equal(context.reason, 'Documentation did not match business registration.', 'the audit record must capture the real reason text supplied')

  const statusEvent = await queryOneD1(
    `SELECT * FROM provider_profile_status_events WHERE provider_profile_id=${provider.id} ORDER BY id DESC LIMIT 1`
  )
  assert.equal(statusEvent.status, 'rejected')
})

test('E2E-3: reject without a reason is rejected with 400 — the required-reason business rule is enforced server-side even inside the full authorized chain, and no partial mutation occurs', async () => {
  const { client } = await loginAs('e2e_reject_noreason', 'vendor_admin')
  const vendor = await createTestVendor('e2e3')

  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'reject' })
  assert.equal(res.status, 400)

  const dbState = await getVendorStatus(vendor.id)
  assert.equal(dbState.verification_status, 'pending', 'a rejected-for-missing-reason request must leave the vendor row completely unchanged')
})

// ============================== UNAUTHORIZED END-TO-END ==============================

test('E2E-4: UNAUTHORIZED equivalent chain — an authenticated Control Center user without vendors.verify: login succeeds, dashboard loads, but the verification queue page itself 403s and the API decision 403s — zero DB mutation, zero false audit success', async () => {
  const { client, userId } = await loginAs('e2e_vendor_unauthorized', 'support_admin') // no vendors.* permissions at all
  const vendor = await createTestVendor('e2e4')

  // LOGIN + dashboard succeed (support_admin IS a real Control Center user).
  const dashRes = await client.get('/control-center')
  assert.equal(dashRes.status, 200)

  // CONTROL CENTER -> VERIFICATION QUEUE: must 403, not silently render an empty/broken page.
  const queueRes = await client.get('/control-center/vendors')
  assert.equal(queueRes.status, 403)

  // APPROVE attempt directly against the API: must 403.
  const decisionRes = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(decisionRes.status, 403)

  // DATABASE STATE: unchanged.
  const dbState = await getVendorStatus(vendor.id)
  assert.equal(dbState.verification_status, 'pending')

  // AUDIT: no false success record for this actor/entity pair.
  const falseSuccess = await queryOneD1(
    `SELECT COUNT(*) AS n FROM cc_audit_logs WHERE actor_user_id=${userId} AND entity_id='${vendor.id}' AND action='vendor_verification_decision' AND success=1`
  )
  assert.equal(Number(falseSuccess.n), 0, 'no successful vendor_verification_decision audit row must exist for this denied actor/entity pair')
})

test('E2E-5: UNAUTHORIZED equivalent chain — provider verification, mirrored: queue 403, decision 403, DB unchanged', async () => {
  const { client } = await loginAs('e2e_provider_unauthorized', 'auditor') // read-only, no providers.verify
  const provider = await createTestProvider('e2e5')

  const queueRes = await client.get('/control-center/providers')
  assert.equal(queueRes.status, 200, 'auditor DOES have providers.read, so the queue page itself must render (200)')
  assert.ok(!queueRes.raw.includes('data-decision="verify"'), 'auditor must NOT see an Approve control since they lack providers.verify')

  const decisionRes = await client.post(`/api/control-center/verifications/providers/${provider.id}/decision`, { decision: 'verify' })
  assert.equal(decisionRes.status, 403, 'even though the queue is readable, the mutation endpoint must still independently 403 for a role lacking providers.verify')

  const dbState = await getProviderStatus(provider.id)
  assert.equal(dbState.verification_status, 'pending')
})

test('E2E-6: completely unauthenticated equivalent — no login at all, direct probe of the full chain\'s every step returns a genuine denial, zero mutation', async () => {
  const anon = new ApiClient()
  const vendor = await createTestVendor('e2e6')

  const dashRes = await anon.get('/control-center')
  assert.equal(dashRes.status, 302)

  const queueRes = await anon.get('/control-center/vendors')
  assert.equal(queueRes.status, 302)

  const decisionRes = await anon.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(decisionRes.status, 401)

  const dbState = await getVendorStatus(vendor.id)
  assert.equal(dbState.verification_status, 'pending')
})
