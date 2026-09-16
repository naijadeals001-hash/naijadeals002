/**
 * Notification Engine — Smoke test #0: validates the test helper chain
 * itself (registerUser/registerSeller/createAndPayOrder/
 * sellerTransitionItem) end-to-end BEFORE the full scenario suite is
 * written on top of it. This is a harness-correctness check, not a
 * business-logic assertion suite — kept deliberately small.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, registerSeller, createAndPayOrder, sellerTransitionItem, promoteToAdmin, queryOneD1, execD1 } from './helpers/client.mjs'

/**
 * ADR-001 Step 2 regression-suite maintenance (2026-09-16): GET
 * /api/admin/notifications/overview was re-homed to
 * /api/control-center/notifications/overview (commit d2655b4) and DELETED
 * from api-admin.ts — this file's positive-control test below was pointed
 * at the now-404 old path. Fixed by updating the URL AND granting the
 * user a real cc_user_roles row: the Control Center route's authorization
 * model (src/lib/control-center-rbac.ts's resolveControlCenterAccess) is
 * NOT `users.role='admin'` — it is a SEPARATE grant on cc_user_roles
 * (independently proven by control-center/01.authentication.test.mjs's
 * AUTH-DENY-5: "a platform-level admin STILL cannot access the Control
 * Center without an explicit cc_user_roles grant"). promoteToAdmin() alone
 * is therefore no longer sufficient to reach a 200 on this route; this
 * local helper grants 'platform_admin' (the same universal positive
 * fixture role used by the Step 2 authz suite — holds notifications.read
 * via migration 0050's blanket rule), directly via D1, mirroring
 * tests/control-center/helpers/client.mjs's own grantControlCenterRole()
 * exactly. Test-only, never a production code path.
 */
async function grantPlatformAdminCcRole(userId) {
  const roleRow = await queryOneD1(`SELECT id FROM cc_roles WHERE key = 'platform_admin'`)
  assert.ok(roleRow, `grantPlatformAdminCcRole: 'platform_admin' not found in cc_roles — check migration 0050's seed data`)
  await execD1(
    `INSERT INTO cc_user_roles (user_id, role_id, assigned_by_user_id) VALUES (${Number(userId)}, ${roleRow.id}, ${Number(userId)})`
  )
}

test('smoke: registerUser + welcome notification event writer fires', async () => {
  const { userId } = await registerUser('smoke_a')
  const outboxRow = await queryOneD1(`SELECT * FROM notification_outbox WHERE idempotency_key = 'account_registered:${userId}'`)
  assert.ok(outboxRow, 'expected an outbox row for account_registered')
  assert.equal(outboxRow.status, 'processed')
  const notifRow = await queryOneD1(`SELECT * FROM notifications WHERE user_id = ${userId}`)
  assert.ok(notifRow, 'expected a real in-app notifications row')
})

test('smoke: registerSeller produces a genuinely owned, onboarded vendor', async () => {
  const { userId, vendorId } = await registerSeller('smoke_b')
  const vendorRow = await queryOneD1(`SELECT * FROM vendors WHERE id = ${vendorId}`)
  assert.equal(vendorRow.user_id, userId)
  assert.equal(vendorRow.verification_status, 'verified')
  assert.equal(vendorRow.store_status, 'active')
  assert.ok(vendorRow.onboarding_completed_at, 'onboarding_completed_at must be set')
})

test('smoke: createAndPayOrder against a specific seller + sellerTransitionItem fires order_item_shipped event', async () => {
  const seller = await registerSeller('smoke_c_seller')
  const { client: customerClient, userId: customerId } = await registerUser('smoke_c_customer')
  const { orderItemId, vendorId } = await createAndPayOrder(customerClient, customerId, { vendorId: seller.vendorId })
  assert.equal(vendorId, seller.vendorId, 'order item must belong to the target seller')

  const res = await sellerTransitionItem(seller.client, orderItemId, 'shipped')
  assert.equal(res.status, 200, `seller transition failed: ${JSON.stringify(res.body)}`)

  const outboxRow = await queryOneD1(`SELECT * FROM notification_outbox WHERE idempotency_key = 'order_item_shipped:${orderItemId}'`)
  assert.ok(outboxRow, 'expected an outbox row for order_item_shipped')
  assert.equal(outboxRow.recipient_user_id, customerId, 'notification must go to the CUSTOMER, not the seller')
})

test('smoke: promoteToAdmin + Control Center overview accessible only to a granted Control Center role', async () => {
  const { client, userId } = await registerUser('smoke_d')
  const before = await client.get('/api/control-center/notifications/overview')
  assert.equal(before.status, 403)

  // promoteToAdmin() (legacy users.role='admin') is retained here to prove
  // it is NOT sufficient on its own for Control Center access — the real
  // grant is the cc_user_roles row below.
  await promoteToAdmin(userId)
  await grantPlatformAdminCcRole(userId)
  // Re-fetch as the SAME client (session cookie unaffected by either the
  // direct role UPDATE or the direct cc_user_roles INSERT — both are
  // resolved fresh from D1 on each request, never cached in the session
  // token).
  const after = await client.get('/api/control-center/notifications/overview')
  assert.equal(after.status, 200, `expected 200 after promotion: ${JSON.stringify(after.body)}`)
  assert.ok(after.body.outbox, 'expected outbox stats in overview response')
})
