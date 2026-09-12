/**
 * Notification Engine — Smoke test #0: validates the test helper chain
 * itself (registerUser/registerSeller/createAndPayOrder/
 * sellerTransitionItem) end-to-end BEFORE the full scenario suite is
 * written on top of it. This is a harness-correctness check, not a
 * business-logic assertion suite — kept deliberately small.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, registerSeller, createAndPayOrder, sellerTransitionItem, promoteToAdmin, queryOneD1 } from './helpers/client.mjs'

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

test('smoke: promoteToAdmin + Control Center overview accessible only to admin', async () => {
  const { client, userId } = await registerUser('smoke_d')
  const before = await client.get('/api/admin/notifications/overview')
  assert.equal(before.status, 403)

  await promoteToAdmin(userId)
  // Re-fetch as the SAME client (session cookie unaffected by the direct
  // role UPDATE — role is read fresh from the users row on each request,
  // not cached in the session token).
  const after = await client.get('/api/admin/notifications/overview')
  assert.equal(after.status, 200, `expected 200 after promotion: ${JSON.stringify(after.body)}`)
  assert.ok(after.body.outbox, 'expected outbox stats in overview response')
})
