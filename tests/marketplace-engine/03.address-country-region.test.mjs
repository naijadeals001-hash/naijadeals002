/**
 * Stage 2C — Country-aware addresses.
 * Proves: addresses.country_iso defaults to NG for backward-compat clients,
 * a client-supplied unsupported country is rejected (never falls through to
 * Nigerian-state logic), /api/addresses/meta/regions is country-parameterized,
 * and orders.shipping_country is correctly populated at checkout.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, RUN_NONCE } from './helpers/client.mjs'

let user

test.before(async () => {
  user = await registerUser('address')
})

test.after(async () => {
  await cleanupRunNonce(RUN_NONCE)
})

test('creating an address WITHOUT country_iso defaults to NG (backward compatibility preserved)', async () => {
  const res = await user.client.post('/api/addresses', {
    label: 'Home',
    recipient_name: 'Test User',
    phone: '08012345678',
    line1: '1 Test Street',
    city: 'Ikeja',
    state: 'Lagos',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const addr = res.body.addresses.find((a) => a.id === res.body.addressId)
  assert.equal(addr.country_iso, 'NG')
})

test('creating an address with an unsupported country_iso is rejected with 400, never silently accepted', async () => {
  const res = await user.client.post('/api/addresses', {
    label: 'Office',
    recipient_name: 'Test User',
    phone: '08012345678',
    line1: '2 Test Street',
    city: 'Accra',
    state: 'Greater Accra',
    country_iso: 'GH',
  })
  assert.equal(res.status, 400, 'GH is not yet in ADDRESS_SUPPORTED_COUNTRIES — must be rejected, not silently coerced to NG')
  assert.match(res.body.error, /not yet supported/i)
})

test('GET /api/addresses/meta/countries returns the supported country list (NG only, by design)', async () => {
  const res = await user.client.get('/api/addresses/meta/countries')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.countries))
  assert.ok(res.body.countries.some((c) => c.iso === 'NG'))
})

test('GET /api/addresses/meta/regions?country=NG returns all 37 Nigerian states via the new country-parameterized path', async () => {
  const res = await user.client.get('/api/addresses/meta/regions?country=NG')
  assert.equal(res.status, 200)
  assert.equal(res.body.regions.length, 37)
})

test('GET /api/addresses/meta/regions?country=GH returns 400 (not yet address-book supported), even though country_regions has GH rows', async () => {
  const res = await user.client.get('/api/addresses/meta/regions?country=GH')
  assert.equal(res.status, 400, 'GH regions exist in country_regions for future use, but the address book itself is NG-only by design — must not silently serve them')
})

test('legacy GET /api/addresses/meta/states endpoint is UNCHANGED and still returns 37 Nigerian states (compatibility preserved)', async () => {
  const res = await user.client.get('/api/addresses/meta/states')
  assert.equal(res.status, 200)
  assert.equal(res.body.states.length, 37)
})

test('checkout with a saved NG address correctly populates orders.shipping_country=NG', async () => {
  const addrRes = await user.client.post('/api/addresses', {
    label: 'Checkout Address',
    recipient_name: 'Test User',
    phone: '08012345678',
    line1: '3 Checkout Street',
    city: 'Ikeja',
    state: 'Lagos',
  })
  const addressId = addrRes.body.addressId

  const ngListing = await queryOneD1(`SELECT id FROM product_listings WHERE currency = 'NGN' AND is_active = 1 AND stock > 0 LIMIT 1`)
  await user.client.post('/api/cart/items', { listing_id: ngListing.id, quantity: 1 })

  const checkoutRes = await user.client.post('/api/orders/checkout', {
    address_id: addressId,
    delivery_method: 'standard',
    payment_method: 'wallet',
  })
  // Wallet likely has insufficient balance — that's fine, the order row is still
  // created (payment failure is a separate, unchanged concern from Stage 2C).
  assert.ok(checkoutRes.body.orderNumber, JSON.stringify(checkoutRes.body))

  const order = await queryOneD1(`SELECT shipping_country FROM orders WHERE order_number = '${checkoutRes.body.orderNumber}'`)
  assert.equal(order.shipping_country, 'NG')
})
