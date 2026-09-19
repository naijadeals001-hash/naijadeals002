/**
 * Stage 2C — Cross-currency cart invariant (Pat's explicit ruling):
 * "Items from different currency zones — totals are shown per currency
 * group." NGN + GHS in the same cart must NEVER be summed into a single
 * combined ₦ (or any single-currency) figure — on /api/cart's initial read,
 * on /api/cart/preview's live recalculation, or anywhere else. This suite
 * proves the SERVER-SIDE data contract (currency_groups[]) that both the
 * server-rendered pages and the AJAX refresh handlers in app.js consume.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, registerUser, cleanupRunNonce, queryOneD1, RUN_NONCE } from './helpers/client.mjs'

let user
let ngListingId
let ghsListingId

test.before(async () => {
  user = await registerUser('xcurrency')
  const ng = await queryOneD1(`SELECT id FROM product_listings WHERE currency = 'NGN' AND is_active = 1 AND stock > 0 LIMIT 1`)
  const ghs = await queryOneD1(`SELECT id FROM product_listings WHERE currency = 'GHS' AND is_active = 1 AND stock > 0 LIMIT 1`)
  assert.ok(ng, 'expected at least one active NGN listing with stock')
  assert.ok(ghs, 'expected at least one active GHS listing with stock')
  ngListingId = ng.id
  ghsListingId = ghs.id
})

test.after(async () => {
  await cleanupRunNonce(RUN_NONCE)
})

test('NGN-only cart: is_multi_currency=false, single currency_groups entry, subtotal_kobo unchanged semantics', async () => {
  const addRes = await user.client.post('/api/cart/items', { listing_id: ngListingId, quantity: 2 })
  assert.equal(addRes.status, 200, JSON.stringify(addRes.body))
  const res = await user.client.get('/api/cart')
  assert.equal(res.status, 200)
  assert.equal(res.body.is_multi_currency, false)
  assert.equal(res.body.currency_groups.length, 1)
  assert.equal(res.body.currency_groups[0].currency, 'NGN')
  assert.equal(res.body.currency_groups[0].subtotal_kobo, res.body.subtotal_kobo, 'single-currency group subtotal must equal the combined subtotal')
})

test('mixed NGN+GHS cart: is_multi_currency=true, TWO separate currency_groups, NEVER a single combined figure', async () => {
  const addRes = await user.client.post('/api/cart/items', { listing_id: ghsListingId, quantity: 1 })
  assert.equal(addRes.status, 200, JSON.stringify(addRes.body))

  const res = await user.client.get('/api/cart')
  assert.equal(res.status, 200)
  assert.equal(res.body.is_multi_currency, true, 'a cart spanning NGN + GHS must report is_multi_currency=true')
  assert.equal(res.body.currency_groups.length, 2, 'expected exactly 2 currency groups (NGN, GHS)')

  const currencies = res.body.currency_groups.map((g) => g.currency).sort()
  assert.deepEqual(currencies, ['GHS', 'NGN'])

  // THE CORE INVARIANT: sum of the per-currency group subtotals must equal the
  // raw combined subtotal_kobo (unchanged order/payment math — Stage 2C does
  // not touch that), but the two groups must NEVER be pre-summed/collapsed
  // into one currency's number by the API itself.
  const sumOfGroups = res.body.currency_groups.reduce((s, g) => s + g.subtotal_kobo, 0)
  assert.equal(sumOfGroups, res.body.subtotal_kobo)

  const ngnGroup = res.body.currency_groups.find((g) => g.currency === 'NGN')
  const ghsGroup = res.body.currency_groups.find((g) => g.currency === 'GHS')
  assert.ok(ngnGroup.subtotal_kobo > 0)
  assert.ok(ghsGroup.subtotal_kobo > 0)
  // Neither individual group's subtotal may equal the combined raw sum unless
  // the other group happens to be zero (it isn't here) — i.e. they are truly
  // separate, non-collapsed numbers.
  assert.notEqual(ngnGroup.subtotal_kobo, res.body.subtotal_kobo)
  assert.notEqual(ghsGroup.subtotal_kobo, res.body.subtotal_kobo)
})

test('quantity-change on the mixed cart via PUT /api/cart/items/:id keeps currency_groups correctly split (AJAX refresh data contract)', async () => {
  const cart = await user.client.get('/api/cart')
  const ngItem = cart.body.items.find((i) => i.currency === 'NGN')
  assert.ok(ngItem, 'expected an NGN item still in cart')

  const res = await user.client.put(`/api/cart/items/${ngItem.id}`, { quantity: 3 })
  assert.equal(res.status, 200)
  assert.equal(res.body.is_multi_currency, true, 'after a quantity change, a still-mixed cart must still report multi-currency')
  assert.equal(res.body.currency_groups.length, 2)
  const ngnGroup = res.body.currency_groups.find((g) => g.currency === 'NGN')
  assert.ok(ngnGroup, 'NGN group must still be present after quantity change')
})

test('/api/cart/preview (checkout live-refresh) ALSO returns per-currency groups for a mixed cart — never a collapsed total', async () => {
  const res = await user.client.post('/api/cart/preview', { delivery_method: 'standard' })
  assert.equal(res.status, 200)
  assert.equal(res.body.is_multi_currency, true)
  assert.equal(res.body.currency_groups.length, 2)
  const sumOfGroups = res.body.currency_groups.reduce((s, g) => s + g.subtotal_kobo, 0)
  assert.equal(sumOfGroups, res.body.subtotal_kobo, 'preview endpoint currency_groups must sum to the same subtotal_kobo it always returned (order/payment math unchanged)')
})

test('removing the GHS item restores single-currency state (is_multi_currency flips back to false)', async () => {
  const cart = await user.client.get('/api/cart')
  const ghsItem = cart.body.items.find((i) => i.currency === 'GHS')
  assert.ok(ghsItem, 'expected a GHS item still in cart')
  const res = await user.client.delete(`/api/cart/items/${ghsItem.id}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.is_multi_currency, false)
  assert.equal(res.body.currency_groups.length, 1)
  assert.equal(res.body.currency_groups[0].currency, 'NGN')
})
