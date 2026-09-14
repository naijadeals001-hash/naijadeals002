/**
 * Enterprise Control Center — Phase 1, Step 12, Category 2: Authorization
 * (granular RBAC). Black-box HTTP tests proving requireControlCenterPermission
 * genuinely gates per-permission, not per-role-as-a-monolith, and that no
 * client-supplied value can influence the authorization decision.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerUser,
  grantControlCenterRole,
  revokeAllControlCenterRoles,
  revokeControlCenterRole,
  createTestVendor,
  execD1,
  queryOneD1,
} from './helpers/client.mjs'

async function loginAs(label, roleKey) {
  const { client, email, password, userId } = await registerUser(label)
  await grantControlCenterRole(userId, roleKey)
  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 200, `login failed for role ${roleKey}: ${JSON.stringify(res.body)}`)
  return { client, userId }
}

// ============================== PERMISSION SUCCESS / FAILURE ==============================

test('AUTHZ-1: a role WITH vendors.verify (vendor_admin) can successfully call the vendor decision endpoint', async () => {
  const { client } = await loginAs('authz_vendoradmin', 'vendor_admin')
  const vendor = await createTestVendor('authz1')

  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.equal(res.body?.newStatus, 'verified')
})

test('AUTHZ-2: a role WITHOUT vendors.verify (support_admin — has customers.read/write, orders.read, bookings.read, disputes.read, notifications.read, audit.read only per migration 0050) gets a genuine 403 calling the SAME endpoint', async () => {
  const { client } = await loginAs('authz_support_noverify', 'support_admin')
  const vendor = await createTestVendor('authz2')

  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(res.status, 403, `expected 403 for a role lacking vendors.verify, got: ${res.status} ${JSON.stringify(res.body)}`)

  const stillPending = await queryOneD1(`SELECT verification_status FROM vendors WHERE id = ${vendor.id}`)
  assert.equal(stillPending.verification_status, 'pending', 'a 403-denied call must never mutate the vendor row')
})

test('AUTHZ-3: an auditor role (every *.read permission, ZERO write/manage/verify/suspend/approve) can read the vendor queue but cannot approve — read/write split verified end-to-end', async () => {
  const { client } = await loginAs('authz_auditor', 'auditor')
  const vendor = await createTestVendor('authz3')

  const readRes = await client.get('/control-center/vendors')
  assert.equal(readRes.status, 200, 'auditor has vendors.read and must be able to view the queue page')

  const writeRes = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(writeRes.status, 403, 'auditor must NOT be able to mutate — the role\'s permission set is read-only by design (migration 0050)')
})

test('AUTHZ-4: role escalation — a Control Center user cannot grant THEMSELVES a higher role via any exposed endpoint (no self-assignment endpoint exists at all in Phase 1)', async () => {
  const { client, userId } = await loginAs('authz_selfescalate', 'support_admin')

  // There is deliberately no POST /api/control-center/roles or similar in
  // Phase 1 (Section 34 explicitly defers a role-assignment UI) — probe the
  // most plausible guesses and confirm every one is a genuine 404/401/403,
  // never a 200 that would indicate a hidden self-service escalation path.
  const candidatePaths = [
    '/api/control-center/roles',
    '/api/control-center/user-roles',
    `/api/control-center/users/${userId}/roles`,
    '/api/control-center/roles/assign',
  ]
  for (const path of candidatePaths) {
    const res = await client.post(path, { userId, roleKey: 'super_admin' })
    assert.notEqual(res.status, 200, `probed path ${path} unexpectedly returned 200 — a self-escalation surface may exist`)
  }

  const rolesAfter = await queryOneD1(`SELECT COUNT(*) AS n FROM cc_user_roles WHERE user_id = ${userId} AND role_id = (SELECT id FROM cc_roles WHERE key='super_admin')`)
  assert.equal(Number(rolesAfter.n), 0, 'no super_admin row must exist for this user after the escalation attempt')
})

test('AUTHZ-5: direct API access cannot bypass what the UI hides — a user whose SSR page correctly hides the Approve button still gets a real 403 hitting the API route directly with curl-equivalent raw fetch (server-side enforcement, not merely UI hiding)', async () => {
  const { client } = await loginAs('authz_directapi', 'support_admin') // support_admin has vendors NO permission at all
  const vendor = await createTestVendor('authz5')

  const pageRes = await client.get('/control-center/vendors')
  assert.equal(pageRes.status, 403, 'support_admin lacks vendors.read entirely, so the SSR page itself must 403 — confirms the page-level gate, not just button-hiding, is real')

  const apiRes = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(apiRes.status, 403, 'the API must independently enforce the SAME boundary — never reachable merely because a client crafts the request without going through the (already-blocked) UI')
})

test('AUTHZ-6: removing a permission immediately prevents the protected operation on the VERY NEXT request — no caching/staleness of the resolved permission set across requests', async () => {
  const { client, userId } = await loginAs('authz_liverevoke', 'vendor_admin')
  const vendor = await createTestVendor('authz6')

  const before = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(before.status, 200, 'vendor_admin must succeed before revocation')

  await revokeControlCenterRole(userId, 'vendor_admin')

  const vendor2 = await createTestVendor('authz6b')
  const after = await client.post(`/api/control-center/verifications/vendors/${vendor2.id}/decision`, { decision: 'verify' })
  assert.equal(after.status, 403, 'the SAME already-authenticated session must be denied immediately after its only CC role is revoked — permissions are resolved fresh per-request from cc_user_roles, never cached in the session/cookie itself')
})

test('AUTHZ-6b: revoking ALL Control Center roles from an authenticated session immediately locks them out of the Control Center entirely (not just the specific permission that was removed)', async () => {
  const { client, userId } = await loginAs('authz_fullrevoke', 'support_admin')

  const before = await client.get('/control-center')
  assert.equal(before.status, 200)

  await revokeAllControlCenterRoles(userId)

  const after = await client.get('/control-center')
  assert.equal(after.status, 302, 'a session with zero remaining cc_user_roles rows must be redirected to login exactly like a never-authorized user — no residual access from the earlier session')
})

test('AUTHZ-7: client-supplied actor identity in the request body is ALWAYS ignored — the audit trail and the mutation both use the SERVER-resolved session user, never a client-claimed adminUserId/actorName/userId field', async () => {
  const { client, userId: realActorId } = await loginAs('authz_spoofactor', 'vendor_admin')
  const { userId: victimId } = await registerUser('authz_spoofactor_victim')
  const vendor = await createTestVendor('authz7')

  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, {
    decision: 'verify',
    // Every one of these client-supplied fields must be silently ignored —
    // the route handler (src/routes/api-control-center.ts) never reads
    // req.body for actor identity, only c.get('user').
    adminUserId: victimId,
    actorUserId: victimId,
    userId: victimId,
    actorName: 'Totally Fake Name',
  })
  assert.equal(res.status, 200)

  const auditRow = await queryOneD1(
    `SELECT actor_user_id, actor_name_snapshot FROM cc_audit_logs WHERE action='vendor_verification_decision' AND entity_id='${vendor.id}' ORDER BY id DESC LIMIT 1`
  )
  assert.equal(Number(auditRow.actor_user_id), realActorId, 'the audit row must record the REAL authenticated actor, never a client-supplied adminUserId/userId')
  assert.notEqual(auditRow.actor_name_snapshot, 'Totally Fake Name', 'the audit row must never trust a client-supplied actorName override')
  assert.notEqual(Number(auditRow.actor_user_id), victimId, 'the client must never be able to attribute an action to a different (victim) user id')
})

test('AUTHZ-8: super_admin implicitly receives a permission with NO explicit cc_role_permissions row for that role (short-circuit verified end-to-end, mirrors organization owner short-circuit)', async () => {
  const { client } = await loginAs('authz_superadmin', 'super_admin')
  const vendor = await createTestVendor('authz8')

  const res = await client.post(`/api/control-center/verifications/vendors/${vendor.id}/decision`, { decision: 'verify' })
  assert.equal(res.status, 200, 'super_admin must succeed on vendors.verify via the implicit all-permissions short-circuit in resolveControlCenterAccess()')

  const auditRes = await client.get('/control-center/audit')
  assert.equal(auditRes.status, 200, 'super_admin must also succeed on audit.read via the same short-circuit')
})
