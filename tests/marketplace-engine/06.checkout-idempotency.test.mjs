import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, RUN_NONCE } from './helpers/client.mjs'

let user

test.before(async () => { user = await registerUser('checkout-idempotency') })
test.after(async () => { await cleanupRunNonce(RUN_NONCE) })

test('retries with one checkout idempotency key reuse the same pending order', async () => {
  const address = await user.client.post('/api/addresses', {
    label: 'Home', recipient_name: 'Checkout User', phone: '08012345678', line1: '1 Test Street', city: 'Ikeja', state: 'Lagos'
  })
  assert.equal(address.status, 200, JSON.stringify(address.body))
  const listing = await queryOneD1(`SELECT id FROM product_listings WHERE currency = 'NGN' AND is_active = 1 AND stock > 0 LIMIT 1`)
  assert.ok(listing?.id)
  const payload = {
    address_id: address.body.addressId,
    delivery_method: 'standard',
    payment_method: 'wallet',
    idempotency_key: `shop-test-${RUN_NONCE}`,
  }
  const first = await user.client.post('/api/orders/checkout', { ...payload, buy_now: { listing_id: listing.id, quantity: 1 } })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.ok(first.body?.orderNumber)
  const second = await user.client.post('/api/orders/checkout', { ...payload, buy_now: { listing_id: listing.id, quantity: 1 } })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.orderNumber, first.body.orderNumber)
  assert.equal(second.body.error, 'insufficient_wallet_balance')
  const count = await queryOneD1(`SELECT COUNT(*) AS count FROM orders WHERE user_id = ${user.userId} AND checkout_idempotency_key = 'shop-test-${RUN_NONCE}'`)
  assert.equal(count.count, 1)
})

test('checkout rejects unsupported payment methods before creating an order', async () => {
  const response = await user.client.post('/api/orders/checkout', { payment_method: 'cash', idempotency_key: `invalid-${RUN_NONCE}`, name: 'User', phone: '08012345678', address: '1 Test Street', city: 'Ikeja', state: 'Lagos' })
  assert.equal(response.status, 400)
  assert.match(response.body.error, /payment_method/i)
})
